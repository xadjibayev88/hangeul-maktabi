import type { TtsProvider, TtsRequest, TtsStream } from "./types.js";
import { clampRate } from "./types.js";

export type ElevenLabsOptions = {
  apiKey?: string;
  voiceId?: string;
  modelId?: string;
  fetchImpl?: typeof fetch;
};

export class ElevenLabsProvider implements TtsProvider {
  readonly name = "elevenlabs";
  private readonly apiKey: string;
  private readonly voiceId: string;
  private readonly modelId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ElevenLabsOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.ELEVENLABS_API_KEY ?? "";
    this.voiceId =
      options.voiceId ?? process.env.ELEVENLABS_KO_VOICE_ID ?? "";
    this.modelId =
      options.modelId ??
      process.env.ELEVENLABS_MODEL_ID ??
      "eleven_flash_v2_5";
    this.fetchImpl = options.fetchImpl ?? fetch;

    if (!this.apiKey) throw new Error("ELEVENLABS_API_KEY is not configured");
    if (!this.voiceId) {
      throw new Error("ELEVENLABS_KO_VOICE_ID is not configured");
    }
  }

  async stream(request: TtsRequest): Promise<TtsStream> {
    if (request.language !== "ko-KR") {
      throw new Error("ElevenLabs adapter currently supports ko-KR only");
    }

    const voiceId = request.voice || this.voiceId;
    const url = new URL(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`,
    );
    url.searchParams.set("output_format", "opus_48000_128");
    url.searchParams.set("optimize_streaming_latency", "2");

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        accept: "audio/ogg, audio/opus, application/octet-stream",
        "content-type": "application/json",
        "xi-api-key": this.apiKey,
      },
      body: JSON.stringify({
        text: request.text,
        model_id: this.modelId,
        language_code: "ko",
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.8,
          use_speaker_boost: true,
          speed: clampRate(request.rate, 0.7, 1.2),
        },
      }),
    });

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `ElevenLabs TTS failed (${response.status}): ${detail.slice(0, 300)}`,
      );
    }

    async function* chunks(): AsyncGenerator<Uint8Array> {
      const reader = response.body!.getReader();
      try {
        for (;;) {
          const item = await reader.read();
          if (item.done) return;
          if (item.value?.byteLength) yield item.value;
        }
      } finally {
        reader.releaseLock();
      }
    }

    return {
      contentType: response.headers.get("content-type") || "audio/opus",
      chunks: chunks(),
    };
  }
}
