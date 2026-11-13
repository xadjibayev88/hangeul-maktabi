# Gemini → ElevenLabs WebSocket: real-time ovoz

Bu modul serverda Gemini SSE matn oqimini o‘qiydi va to‘liq gap paydo bo‘lishi bilan ElevenLabs WebSocket’iga yuboradi. Audio chunklar alohida navbatdan darhol olinadi. Butun Gemini javobi yoki butun audio fayli yig‘ilib bo‘lishi kutilmaydi.

## Ishga tushirish

Node.js 22 yoki yangiroq kerak. `server/tts` papkasida:

```bash
npm ci
cp .env.example .env
# .env ichidagi GEMINI_API_KEY va ELEVENLABS_API_KEY qiymatlarini
# faqat serverda maxfiy tarzda kiriting.
npm run typecheck
npm test
npm run voice:demo -- "Learner: 저는 한국어를 공부해요."
```

`voice:demo` haqiqiy pullik API so‘rovlari yuboradi. Offline testlar haqiqiy kalitlardan foydalanmaydi va tashqi APIga chiqmaydi. `.env` fayli avtomatik ravishda demo komandasi orqali yuklanadi; oddiy library import `.env`ni o‘zi yuklamaydi. Productionda kalitlar hosting secret/environment orqali beriladi.

Demo kelayotgan audio chunklarini `answer.pcm`ga yozadi va terminalga Gemini matnini chiqaradi. Audioni ijro qilish:

```bash
ffplay -f s16le -ar 24000 -ac 1 answer.pcm
# Yoki WAVga o‘tkazish:
ffmpeg -f s16le -ar 24000 -ac 1 -i answer.pcm answer.wav
```

PCM — 24 kHz, mono, signed 16-bit little-endian. Bu WAV/MP3 fayli emas; `new Audio()`ga bevosita berib bo‘lmaydi. Brauzer integratsiyasi uchun PCM fragmentlarini Web Audio/AudioWorklet player orqali navbat bilan ijro qilish kerak. Ushbu topshiriqda production frontend playeri yoki server deploymenti qo‘shilmadi.

## Asosiy API

```ts
import { createGeminiVoiceStream } from "./gemini-elevenlabs.js";

const controller = new AbortController();
const voice = await createGeminiVoiceStream(
  "Learner: 저는 한국어를 공부해요. Reply at TOPIK level 1.",
  {
    signal: controller.signal,
    rate: 0.95,
    gemini: { model: "gemini-2.5-flash" },
    elevenlabs: {
      modelId: "eleven_flash_v2_5",
      voiceId: process.env.ELEVENLABS_KO_VOICE_ID,
      turnTimeoutMs: 60_000,
    },
    onText: (fragment) => {
      // Frontend transcript kanaliga uzatish mumkin.
      // Bu callback tez ishlashi kerak: aks holda matn oqimini sekinlashtiradi.
    },
    onEvent: (event) => {
      // turnId, event.type, elapsedMs. Secret/transcriptni log qilish shart emas.
      console.log(event.type, event.elapsedMs);
    },
  },
);

try {
  for await (const pcm of voice.chunks) {
    // Client socket yoki streaming response'ga uzating.
    // Tarmoq writeri sekinlashganda backpressure'ni kuting.
    await sendAudioChunk(pcm); // Ilovangizdagi writer funksiyasi.
  }
} finally {
  voice.cancel();
}

// Foydalanuvchi gapni bo‘lganda: controller.abort() yoki voice.cancel().
```

`voice.chunks` bir consumer uchun. Uni hech qachon iste’mol qilmay qoldirmang: agar client uzilsa, `voice.cancel()` chaqiring. Iteratorni erta yakunlash ham provider va Gemini so‘rovini bekor qiladi. Audio navbati cheklangan; consumer juda sekin bo‘lsa ulanish xato bilan to‘xtaydi, xotira cheksiz oshmaydi.

## Mavjud TTS kontrakti bilan ishlatish

```ts
import { ElevenLabsWebSocketProvider } from "./elevenlabs-websocket.js";

const provider = new ElevenLabsWebSocketProvider({
  outputFormat: "opus_48000_128", // Yoki pcm_24000, mp3_44100_128.
});
const result = await provider.stream({
  text: "안녕하세요. 오늘 뭐 하고 싶어요?",
  language: "ko-KR",
  rate: 0.95,
});
for await (const audioChunk of result.chunks) {
  await sendAudioChunk(audioChunk);
}
```

`stream()` umumiy `TtsProvider` kontraktiga mos. `streamText()` esa matnni kechikib ishlab chiqaradigan generator qabul qiladi. Generator unga berilgan `AbortSignal`ga amal qilishi kerak; bridge’dagi Gemini klienti bunga amal qiladi. Provider nomi `elevenlabs-websocket`; eski `/api/tts` routerida avtomatik ro‘yxatdan o‘tkazilmadi, chunki PCM va Ogg player ehtiyojlari farq qiladi.

## Framework-neutral HTTP ulash namunasi

Quyidagi wrapper faqat integratsiya namunasi. Real ilovada `authorize()` haqiqiy sessionni tekshirishi, framework/proxy body limit va rate limitni ta’minlashi kerak. Kalitga ega pullik endpointni autentifikatsiyasiz public qilmang.

```ts
import { createGeminiVoiceStream } from "./gemini-elevenlabs.js";

async function voiceHandler(request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  if (!(await authorize(request))) return new Response(null, { status: 401 });
  const input = await request.json() as { prompt?: unknown };
  if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 12000) {
    return Response.json({ error: "Invalid prompt" }, { status: 400 });
  }
  const voice = await createGeminiVoiceStream(input.prompt, { signal: request.signal });
  const iterator = voice.chunks[Symbol.asyncIterator]();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close(); else controller.enqueue(next.value);
      } catch {
        voice.cancel();
        controller.error(new Error("Voice stream failed"));
      }
    },
    async cancel() {
      voice.cancel();
      await iterator.return?.();
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "no-store",
      "x-audio-encoding": voice.encoding,
      "x-audio-sample-rate": String(voice.sampleRate),
      "x-audio-channels": String(voice.channels),
      "x-turn-id": voice.turnId,
      "x-accel-buffering": "no",
    },
  });
}
```

Har bir turnning alohida IDsi bor. Brauzer eski turn audio chunklarini tashlab yuborishi va o‘z playback navbatini ham tozalashi kerak. Serverda abort qilish brauzerda allaqachon buffered audioni o‘z-o‘zidan to‘xtatmaydi. Reverse proxy streamingni bufferlamasligi kerak. O‘zbekcha tarjima va corrections uchun alohida metadata oqimi qo‘shiladi; ularni ushbu voice matniga aralashtirmang.

## Protokol va sifat qarorlari

ElevenLabs ulanishi Gemini so‘rovidan oldin ochiladi. Handshake’da `xi-api-key` server headeri ishlatiladi; URLga kalit qo‘yilmaydi. Boshlang‘ich xabar `text: " "` bo‘ladi. `auto_mode=true` ishlatilgani sababli mayda tokenlar emas, to‘liq gaplar yuboriladi. Bu rejim to‘liq gaplar uchun tavsiya etiladi; partial jumlalar audio sifatini keskin kamaytirishi mumkin. [1]

Oxirgi tugallanmagan matn `flush:true` bilan yuboriladi. Keyin `text: ""` end-of-input signali yuboriladi. Socket lokal ravishda darhol yopilmaydi: audio va final marker kutiladi. Reference’dagi `is_final` ham, ayrim misollardagi `isFinal` ham qo‘llab-quvvatlanadi. `flush` audioni majburan generatsiya qilish uchun ishlatiladi. [1] [2]

Gemini voice yo‘li faqat koreyscha plain text qaytarishga yo‘naltirilgan. Oldingi `streamVoiceSend()` JSONini bu pipeline’ga to‘g‘ridan-to‘g‘ri yubormang: aks holda JSON kalitlari, romanizatsiya va tarjima ham o‘qilishi mumkin. Custom `systemInstruction` ishlatsangiz shu plain-text kontraktini saqlang. SSE oqimi Gemini’ning `streamGenerateContent` usulidan olinadi. [3]

Timeout, client abort va provider xatosi producer/consumerga birgalikda ta’sir qiladi. Avtomatik retry qo‘shilmadi: ovoz boshlanganidan keyin qayta generatsiya bir xil gapni takrorlash va ikki marta billingga olib kelishi mumkin. Timeoutlar real latencyga qarab sozlanadi. `first_audio_received` serverga chunk kelgan vaqt; bu foydalanuvchi uni eshitgan vaqt emas.

## References

[1]: https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input "ElevenLabs TTS WebSocket reference"
[2]: https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tts "ElevenLabs real-time TTS guide"
[3]: https://ai.google.dev/gemini-api/docs/text-generation "Gemini text generation and streaming"

## Tekshiruv holati

Gemini SSE, ElevenLabs WebSocket va bridge uchun offline testlar hamda TypeScript typecheck bajarildi. Bridge mock testi birinchi audio Gemini SSE hali ochiq bo‘lganida olinayotganini tekshiradi. Bundan tashqari Unicode/CRLF chunklar, takroriy gaplar, abort, timeout, bo‘sh/xato/truncated javob va audio buffer limiti tekshiriladi.

Bu yangi WebSocket yo‘li haqiqiy Gemini + ElevenLabs server kalitlari bilan end-to-end ishga tushirilmagan. Oldingi Manus connector audio testi boshqa yo‘l edi. Ishlaydigan demo kodi tayyor, lekin production latency yoki browser playback bo‘yicha o‘lchangan natija yo‘q. GitHub’ga push va deployment ushbu kod yozish bosqichining bir qismi emas.
