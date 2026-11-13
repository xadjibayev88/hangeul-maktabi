import {
  protos,
  TextToSpeechClient,
} from "@google-cloud/text-to-speech";
import type { TtsProvider, TtsRequest, TtsStream } from "./types.js";
import { clampRate } from "./types.js";

const AudioEncoding = protos.google.cloud.texttospeech.v1.AudioEncoding;

export type GoogleTtsOptions = {
  client?: TextToSpeechClient;
  defaultVoice?: string;
};

export class GoogleTtsProvider implements TtsProvider {
  readonly name = "google";
  private readonly client: TextToSpeechClient;
  private readonly defaultVoice: string;

  constructor(options: GoogleTtsOptions = {}) {
    this.client = options.client ?? new TextToSpeechClient();
    this.defaultVoice =
      options.defaultVoice ??
      process.env.GOOGLE_TTS_KO_VOICE ??
      "ko-KR-Chirp3-HD-Kore";
  }

  async stream(request: TtsRequest): Promise<TtsStream> {
    if (request.language !== "ko-KR") {
      throw new Error("Google Chirp 3 adapter currently supports ko-KR only");
    }

    const source = this.client.streamingSynthesize();
    const voiceName = request.voice || this.defaultVoice;

    source.write({
      streamingConfig: {
        voice: {
          languageCode: request.language,
          name: voiceName,
        },
        streamingAudioConfig: {
          audioEncoding: AudioEncoding.OGG_OPUS,
          speakingRate: clampRate(request.rate),
        },
      },
    });
    source.write({ input: { text: request.text } });
    source.end();

    async function* chunks(): AsyncGenerator<Uint8Array> {
      try {
        for await (const response of source) {
          if (response.audioContent) {
            yield Buffer.from(response.audioContent as Uint8Array);
          }
        }
      } finally {
        source.destroy();
      }
    }

    return {
      contentType: "audio/ogg; codecs=opus",
      chunks: chunks(),
    };
  }
}
