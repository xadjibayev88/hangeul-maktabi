import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { resolve } from "node:path";
import { createGeminiVoiceStream } from "./gemini-elevenlabs.js";

// npm run voice:demo -- "Learner: 저는 한국어를 공부해요."
// Real API calls are billable. Run only with your authorized server credentials.
const prompt = process.argv[2] ?? "Learner: 안녕하세요. 저는 한국어를 공부하고 싶어요.";
const destination = resolve(process.argv[3] ?? "answer.pcm");
const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGINT", stop);

try {
  const voice = await createGeminiVoiceStream(prompt, {
    signal: controller.signal,
    onText: (text) => process.stdout.write(text),
    onEvent: (event) => console.error(`[${event.type}] ${Math.round(event.elapsedMs)} ms`),
  });
  try {
    // pipeline honors file backpressure while Gemini/TTS run concurrently.
    await pipeline(Readable.from(voice.chunks), createWriteStream(destination), {
      signal: controller.signal,
    });
    console.log(`\nPCM 24 kHz, mono, signed 16-bit little-endian: ${destination}`);
    console.log("Play: ffplay -f s16le -ar 24000 -ac 1 answer.pcm");
  } finally {
    voice.cancel();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Voice demo failed");
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", stop);
}
