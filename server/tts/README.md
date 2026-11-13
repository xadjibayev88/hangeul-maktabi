# TTS adapter

Bu paket Google Cloud Chirp 3 HD va ElevenLabs providerlarini bir xil streaming interfeys orqali ulaydi.

## O‘rnatish

```bash
npm install @google-cloud/text-to-speech
npm install -D typescript @types/node
```

ElevenLabs uchun alohida SDK shart emas: adapter `fetch` orqali rasmiy streaming endpointdan foydalanadi.

## Environment

```bash
TTS_PROVIDER=google
GOOGLE_TTS_KO_VOICE=ko-KR-Chirp3-HD-Kore
GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/google-tts.json

# ElevenLabs ishlatilsa
ELEVENLABS_API_KEY=server-only-secret
ELEVENLABS_KO_VOICE_ID=cgSgspJ2msm6clMCkdW9
ELEVENLABS_MODEL_ID=eleven_flash_v2_5
```

Google adapter Application Default Credentials orqali autentifikatsiya qilinadi. ElevenLabs API key hech qachon frontend, `index.html` yoki `localStorage`ga qo‘yilmaydi.

Manus’dagi ElevenLabs connector muvaffaqiyatli tekshirildi. U koreyscha test audio’ni `Ogg/Opus 48 kHz mono` formatida yaratdi va shu testda ishlatilgan voice ID `cgSgspJ2msm6clMCkdW9` adapterning default voice’i sifatida qo‘yildi. Connector Manus agentining o‘zida ishlaydi; GitHub Pages esa connector secret’ini ko‘rmaydi. Production `/api/tts` serverida `ELEVENLABS_API_KEY` environment secret sifatida berilishi kerak.

## Express adapteri

`createTtsHandler` Web `Request`/`Response` qaytaradi. Express ishlatilsa, route wrapper kerak:

```ts
import express from "express";
import { ttsHandler } from "./server/tts";

const app = express();
app.use(express.json({ limit: "32kb" }));

app.post("/api/tts", async (req, res) => {
  const request = new Request("http://localhost/api/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req.body),
  });
  const response = await ttsHandler(request);
  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  if (!response.body) return res.end();
  const reader = response.body.getReader();
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      res.write(Buffer.from(item.value));
    }
  } finally {
    reader.releaseLock();
    res.end();
  }
});

app.listen(3000);
```

## Request

```http
POST /api/tts
Content-Type: application/json

{
  "text": "안녕하세요. 오늘 뭐 하고 싶어요?",
  "language": "ko-KR",
  "rate": 0.95,
  "provider": "google"
}
```

`provider` berilmasa `TTS_PROVIDER` ishlatiladi. Ruxsat etilgan qiymatlar: `google` va `elevenlabs`.

## Test curl

```bash
curl -N -X POST http://localhost:3000/api/tts \
  -H 'content-type: application/json' \
  -d '{"text":"안녕하세요. 오늘 뭐 하고 싶어요?","language":"ko-KR"}' \
  --output answer.ogg
```

Google va ElevenLabs audio codecini backend bir xil `audio/ogg; codecs=opus` ko‘rinishiga moslashi kerak. ElevenLabs accountidagi voice ID koreyscha multilingual voice bo‘lishi lozim.

## Gemini matni → ElevenLabs WebSocket

Real-time pipeline qo‘shildi. `createGeminiVoiceStream()` Gemini SSE tokenlarini to‘liq koreyscha gaplarga yig‘adi va ElevenLabs WebSocket orqali audio chunklarga aylantiradi. API keylar faqat serverda qoladi. [REALTIME.md](./REALTIME.md)da to‘liq API, `npm run voice:demo`, offline testlar, PCM format va serverga ulash namunasi bor.

```bash
cd server/tts
npm ci
npm run typecheck
npm test
```
