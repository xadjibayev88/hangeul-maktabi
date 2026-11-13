import { ElevenLabsProvider } from "./elevenlabs.js";
import { GoogleTtsProvider } from "./google.js";
import {
  assertTtsRequest,
  type TtsProvider,
  type TtsRequest,
} from "./types.js";

export type TtsRouterOptions = {
  providers?: Record<string, TtsProvider>;
  defaultProvider?: string;
};

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function createTtsHandler(options: TtsRouterOptions = {}) {
  const providers = options.providers ?? {
    google: new GoogleTtsProvider(),
    elevenlabs: new ElevenLabsProvider(),
  };
  const defaultProvider =
    options.defaultProvider ?? process.env.TTS_PROVIDER ?? "google";

  return async function ttsHandler(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Request body must be valid JSON" }, 400);
    }

    try {
      assertTtsRequest(body);
      const input = body as TtsRequest & { provider?: unknown };
      const providerName =
        typeof input.provider === "string"
          ? input.provider
          : defaultProvider;
      const provider = providers[providerName];

      if (!provider) {
        return json({ error: `Unknown TTS provider: ${providerName}` }, 400);
      }

      const audio = await provider.stream(input);
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            for await (const chunk of audio.chunks) {
              controller.enqueue(chunk);
            }
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });

      return new Response(stream, {
        headers: {
          "content-type": audio.contentType,
          "cache-control": "no-store, no-cache",
          "x-content-type-options": "nosniff",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "TTS failed";
      console.error("[tts]", message);
      return json({ error: "TTS unavailable" }, 502);
    }
  };
}

export const ttsHandler = createTtsHandler();
