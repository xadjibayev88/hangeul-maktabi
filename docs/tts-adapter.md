# Google Cloud TTS va ElevenLabs: umumiy streaming adapter

Go Topic frontendi provider nomini bilmasligi kerak. U faqat `POST /api/tts` ga matn va til yuboradi. Backend esa `TTSProvider` interfeysi orqali Google Cloud Chirp 3 HD yoki ElevenLabs'ni tanlaydi.

Google Cloud Chirp 3 HD koreyscha `ko-KR` va streaming synthesis'ni qo'llaydi. ElevenLabs esa koreyscha multilingual voice'lar va real-time audio streaming'ni qo'llaydi.

## Umumiy kontrakt

```ts
// server/tts/types.ts
export type TtsLanguage = "ko-KR" | "uz-UZ";

export type TtsRequest = {
  text: string;
  language: TtsLanguage;
  voice?: string;
  rate?: number; // 0.25 ... 2.0
};

export type TtsStream = {
  contentType: string;
  // Provider audio chunklari ketma-ketligi.
  chunks: AsyncIterable<Uint8Array>;
};

export interface TtsProvider {
  stream(request: TtsRequest): Promise<TtsStream>;
}
```

`chunks` providerga bog'liq audio formatda bo'lishi mumkin. Productionda browserda bir xil player ishlatish kerak bo'lsa, ikkala provider uchun ham `audio/ogg; codecs=opus` tanlanadi yoki backendda bitta umumiy formatga transcode qilinadi.

## Google Cloud Chirp 3 HD adapteri

Cloud TTS streaming API birinchi requestda voice va audio konfiguratsiyasini, keyingi requestlarda esa text chunklarini kutadi.

```ts
// server/tts/google.ts
import textToSpeech from "@google-cloud/text-to-speech";
import type { TtsProvider, TtsRequest, TtsStream } from "./types";

const client = new textToSpeech.TextToSpeechClient();

const googleVoice = (request: TtsRequest) => {
  if (request.voice) return request.voice;
  return request.language === "ko-KR"
    ? "ko-KR-Chirp3-HD-Kore"
    : "en-US-Chirp3-HD-Leda";
};

export class GoogleTtsProvider implements TtsProvider {
  async stream(request: TtsRequest): Promise<TtsStream> {
    const source = client.streamingSynthesize();

    source.write({
      streamingConfig: {
        voice: {
          languageCode: request.language,
          name: googleVoice(request),
        },
        streamingAudioConfig: {
          audioEncoding: "OGG_OPUS",
          speakingRate: Math.max(0.25, Math.min(2, request.rate ?? 1)),
        },
      },
    });

    source.write({ input: { text: request.text } });
    source.end();

    async function* audioChunks() {
      for await (const response of source) {
        if (response.audioContent) {
          yield Buffer.from(response.audioContent as Uint8Array);
        }
      }
    }

    return {
      contentType: "audio/ogg; codecs=opus",
      chunks: audioChunks(),
    };
  }
}
```

Agar Gemini javobi gapma-gap kelayotgan bo'lsa, `request.text`ga birinchi tugagan gapni darhol yuborish mumkin. Keyingi gaplar uchun alohida request yuborilganda `previousText` yoki providerning continuity mexanizmi kerak bo'lishi mumkin; buni keyingi iteratsiyada qo'shish ma'qul.

## ElevenLabs adapteri

ElevenLabs HTTP streaming endpointidan kelgan `ReadableStream`ni umumiy `AsyncIterable<Uint8Array>` ko'rinishiga o'tkazamiz.

```ts
// server/tts/eleven.ts
import type { TtsProvider, TtsRequest, TtsStream } from "./types";

const voiceFor = (request: TtsRequest) =>
  request.voice || process.env.ELEVENLABS_KO_VOICE_ID!;

export class ElevenLabsProvider implements TtsProvider {
  async stream(request: TtsRequest): Promise<TtsStream> {
    const voiceId = voiceFor(request);
    const url = new URL(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
    );
    // Opus 48 kHz is suitable for low-latency browser playback.
    url.searchParams.set("output_format", "opus_48000_128");
    url.searchParams.set("optimize_streaming_latency", "2");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "xi-api-key": process.env.ELEVENLABS_API_KEY!,
      },
      body: JSON.stringify({
        text: request.text,
        model_id: "eleven_flash_v2_5",
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.8,
          use_speaker_boost: true,
          speed: Math.max(0.7, Math.min(1.2, request.rate ?? 1)),
        },
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`ElevenLabs TTS failed: ${response.status}`);
    }

    async function* audioChunks() {
      for await (const chunk of response.body!) {
        yield new Uint8Array(chunk as Buffer);
      }
    }

    return {
      contentType: "audio/ogg; codecs=opus",
      chunks: audioChunks(),
    };
  }
}
```

ElevenLabs accountidagi voice ID koreys tiliga mos bo'lishi kerak. API key frontendga emas, faqat server environment'iga qo'yiladi.

## Provider router va `/api/tts`

```ts
// server/tts/router.ts
import type { TtsProvider, TtsRequest } from "./types";
import { GoogleTtsProvider } from "./google";
import { ElevenLabsProvider } from "./eleven";

const providers: Record<string, TtsProvider> = {
  google: new GoogleTtsProvider(),
  eleven: new ElevenLabsProvider(),
};

export async function ttsHandler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const body = (await req.json()) as TtsRequest & { provider?: string };
  const providerName = body.provider || process.env.TTS_PROVIDER || "google";
  const provider = providers[providerName];

  if (!provider || !body.text || !["ko-KR", "uz-UZ"].includes(body.language)) {
    return Response.json({ error: "Invalid TTS request" }, { status: 400 });
  }

  const audio = await provider.stream(body);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of audio.chunks) controller.enqueue(chunk);
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": audio.contentType,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
```

## Frontenddagi yagona chaqiruv

```js
async function speakWithServer(text, language = "ko-KR") {
  const response = await fetch("/api/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, language }),
  });
  if (!response.ok || !response.body) throw new Error("TTS unavailable");

  const audio = new Audio(URL.createObjectURL(
    await new Blob([await response.arrayBuffer()], {
      type: response.headers.get("content-type") || "audio/ogg",
    }),
  ));
  await audio.play();
}
```

Haqiqiy gapma-gap playback uchun `Blob`ni to'liq kutmasdan `MediaSource` yoki Web Audio API buffer queue ishlatiladi. Oddiy birinchi versiyada yuqoridagi player yetarli; keyingi versiyada `response.body` chunklarini audio buffer sifatida navbatga qo'yish kerak.

## Provider tanlash tavsiyasi

- Default: `google`, chunki koreyscha Chirp 3 HD va Google Cloud authentication bir ekotizimda.
- Premium natural voice: `eleven`, ayniqsa `eleven_flash_v2_5` real-time dialog uchun.
- Browser TTS: har ikkisi ishlamasa fallback.

```env
TTS_PROVIDER=google
ELEVENLABS_API_KEY=server-only-secret
ELEVENLABS_KO_VOICE_ID=server-only-voice-id
GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/google-tts.json
```

API keylarni `index.html`, localStorage yoki GitHub Pages kodiga qo'yish mumkin emas.
