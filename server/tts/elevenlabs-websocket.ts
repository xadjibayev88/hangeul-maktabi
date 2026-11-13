import WebSocket, { type ClientOptions } from "ws";
import { AudioQueue } from "./audio-queue.js";
import { SentenceBuffer } from "./sentence-buffer.js";
import { assertTtsRequest, clampRate, type TtsProvider, type TtsRequest, type TtsStream } from "./types.js";

export type RealtimeAudioFormat = "pcm_24000" | "opus_48000_128" | "mp3_44100_128";
export type VoiceStreamEvent = {
  type: "socket_open" | "first_text_sent" | "first_audio_received" | "finished";
  elapsedMs: number;
};
export type ElevenLabsWebSocketOptions = {
  apiKey?: string;
  voiceId?: string;
  modelId?: string;
  outputFormat?: RealtimeAudioFormat;
  connectTimeoutMs?: number;
  turnTimeoutMs?: number;
  maxBufferedAudioBytes?: number;
  onEvent?: (event: VoiceStreamEvent) => void;
  /** Dependency injection for offline tests; do not accept a URL from users. */
  socketFactory?: (url: string, options: ClientOptions) => WebSocket;
};
export type StreamingTextRequest = Omit<TtsRequest, "text"> & { signal?: AbortSignal };

function abortError(): Error {
  return new DOMException("Voice turn aborted", "AbortError");
}

/**
 * One authenticated socket per voice turn. Text producer and audio consumer
 * operate concurrently. Complete sentences keep auto_mode audio quality stable.
 */
export class ElevenLabsWebSocketProvider implements TtsProvider {
  readonly name = "elevenlabs-websocket";
  constructor(private readonly options: ElevenLabsWebSocketOptions = {}) {}

  async stream(request: TtsRequest): Promise<TtsStream> {
    assertTtsRequest(request);
    return this.streamText(async function* () { yield request.text; }, request);
  }

  async streamText(
    createText: (signal: AbortSignal) => AsyncIterable<string>,
    request: StreamingTextRequest,
  ): Promise<TtsStream> {
    if (request.language !== "ko-KR") throw new Error("Only ko-KR is supported");
    if (request.signal?.aborted) throw abortError();
    const apiKey = this.options.apiKey ?? process.env.ELEVENLABS_API_KEY;
    if (!apiKey?.trim()) throw new Error("ELEVENLABS_API_KEY is not configured");
    const voiceId = request.voice ?? this.options.voiceId ??
      process.env.ELEVENLABS_KO_VOICE_ID ?? "cgSgspJ2msm6clMCkdW9";
    const modelId = this.options.modelId ?? process.env.ELEVENLABS_MODEL_ID ?? "eleven_flash_v2_5";
    if (!/^[A-Za-z0-9_-]{1,100}$/u.test(voiceId)) throw new Error("Invalid voice ID");
    if (["eleven_v3", "eleven_v4"].includes(modelId)) {
      throw new Error("This model is not supported by the TTS WebSocket endpoint");
    }
    const format = this.options.outputFormat ?? "pcm_24000";
    if (!["pcm_24000", "opus_48000_128", "mp3_44100_128"].includes(format)) {
      throw new Error("Unsupported realtime audio format");
    }
    const url = new URL(`wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream-input`);
    url.searchParams.set("model_id", modelId);
    url.searchParams.set("language_code", "ko");
    url.searchParams.set("output_format", format);
    url.searchParams.set("auto_mode", "true"); // Only complete sentences below.
    url.searchParams.set("inactivity_timeout", "60");

    const started = performance.now();
    const report = (type: VoiceStreamEvent["type"]) => this.options.onEvent?.({
      type, elapsedMs: performance.now() - started,
    });
    const local = new AbortController();
    const queue = new AudioQueue(this.options.maxBufferedAudioBytes);
    const factory = this.options.socketFactory ?? ((uri, config) => new WebSocket(uri, config));
    const socket = factory(url.toString(), {
      headers: { "xi-api-key": apiKey },
      handshakeTimeout: this.options.connectTimeoutMs ?? 10_000,
      maxPayload: 2 * 1024 * 1024,
      perMessageDeflate: false,
    });
    let terminal = false;
    let inputEnded = false;
    let textSent = false;
    let audioBytes = 0;
    let keepAlive: ReturnType<typeof setInterval> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resolveOpen!: () => void;
    let rejectOpen!: (error: Error) => void;
    const opened = new Promise<void>((resolve, reject) => {
      resolveOpen = resolve; rejectOpen = reject;
    });
    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(keepAlive);
      request.signal?.removeEventListener("abort", onAbort);
    };
    const fail = (error: Error) => {
      if (terminal) return;
      terminal = true;
      cleanup();
      queue.fail(error);
      rejectOpen(error);
      local.abort(error); // Also cancels the Gemini fetch producer.
      socket.terminate();
    };
    const finish = () => {
      if (terminal) return;
      if (!audioBytes) { fail(new Error("ElevenLabs returned no audio")); return; }
      try { report("finished"); } catch { fail(new Error("Voice event callback failed")); return; }
      terminal = true;
      cleanup();
      queue.end();
      local.abort();
      socket.close(1000);
    };
    const onAbort = () => fail(abortError());
    request.signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => fail(new Error("Voice turn timed out")), this.options.turnTimeoutMs ?? 60_000);

    socket.on("open", () => {
      try { report("socket_open"); resolveOpen(); }
      catch { fail(new Error("Voice event callback failed")); }
    });
    // Upstream error messages can contain credentials; expose only safe messages.
    socket.on("error", () => fail(new Error("ElevenLabs WebSocket connection failed")));
    socket.on("unexpected-response", (_req, response) => {
      response.resume();
      fail(new Error(`ElevenLabs handshake failed (${response.statusCode ?? 502})`));
    });
    socket.on("message", (raw, isBinary) => {
      if (terminal) return;
      try {
        if (isBinary) throw new Error("Expected an ElevenLabs JSON message");
        const data: unknown = JSON.parse(raw.toString());
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          throw new Error("Invalid ElevenLabs message");
        }
        const event = data as Record<string, unknown>;
        if (event.error || event.message || event.error_code) {
          throw new Error("ElevenLabs rejected the voice stream");
        }
        if (typeof event.audio === "string" && event.audio.length) {
          // Reject malformed base64 instead of silently decoding an invalid stream.
          if (event.audio.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(event.audio)) {
            throw new Error("Invalid audio encoding");
          }
          const audio = Buffer.from(event.audio, "base64");
          if (!audio.byteLength) throw new Error("Invalid audio encoding");
          if (!audioBytes) report("first_audio_received");
          audioBytes += audio.byteLength;
          queue.push(audio);
        }
        // Official reference uses is_final; SDK/examples can use isFinal.
        if ((event.is_final === true || event.isFinal === true) && inputEnded) finish();
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Invalid ElevenLabs message"));
      }
    });
    socket.on("close", (code) => {
      if (terminal) return;
      // Some versions end with a normal close without a final marker.
      if (code === 1000 && inputEnded) finish();
      else fail(new Error(`ElevenLabs closed before completion (${code})`));
    });

    const send = async (message: object): Promise<void> => {
      if (terminal || local.signal.aborted || socket.readyState !== WebSocket.OPEN) throw abortError();
      await new Promise<void>((resolve, reject) => {
        socket.send(JSON.stringify(message), (error) => {
          if (error) reject(new Error("ElevenLabs text send failed")); else resolve();
        });
      });
    };

    try {
      await opened;
      await send({
        text: " ", // Required initial message. Auth is in the handshake header.
        voice_settings: {
          stability: 0.45, similarity_boost: 0.8,
          use_speaker_boost: false, speed: clampRate(request.rate, 0.7, 1.2),
        },
      });
    } catch (error) {
      fail(error instanceof Error ? error : new Error("Voice stream initialization failed"));
      throw error;
    }
    keepAlive = setInterval(() => {
      if (!inputEnded && !terminal && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ text: " " }), (error) => {
          if (error) fail(new Error("Voice keepalive failed"));
        });
      }
    }, 10_000);

    const produce = async () => {
      const buffer = new SentenceBuffer();
      let characters = 0;
      const sendText = async (text: string, flush = false) => {
        if (!text.trim()) return;
        await send({ text: /\s$/u.test(text) ? text : text + " ", ...(flush ? { flush: true } : {}) });
        if (!textSent) { textSent = true; report("first_text_sent"); }
      };
      for await (const fragment of createText(local.signal)) {
        if (local.signal.aborted) throw abortError();
        if (typeof fragment !== "string") throw new Error("Text fragment must be a string");
        characters += fragment.length;
        if (characters > 6000) throw new Error("Voice turn text limit exceeded");
        for (const sentence of buffer.push(fragment)) await sendText(sentence);
      }
      const rest = buffer.finish();
      if (rest.trim()) await sendText(rest, true);
      else if (textSent) await send({ text: " ", flush: true });
      if (!textSent) throw new Error("No text to synthesize");
      inputEnded = true;
      clearInterval(keepAlive);
      // EOS tells ElevenLabs to synthesize remaining input; do NOT close locally
      // until all audio/is_final has arrived.
      await send({ text: "" });
    };
    void produce().catch((error: unknown) => {
      fail(error instanceof Error ? error : new Error("Text producer failed"));
    });

    let consumed = false;
    const chunks = {
      async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
        if (consumed) throw new Error("Voice audio stream supports one consumer only");
        consumed = true;
        try { yield* queue; }
        finally { if (!terminal) fail(abortError()); }
      },
    };
    return {
      contentType: format === "pcm_24000" ? "application/octet-stream" :
        format === "opus_48000_128" ? "audio/ogg; codecs=opus" : "audio/mpeg",
      chunks,
    };
  }
}
