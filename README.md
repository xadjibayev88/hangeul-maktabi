# Go Topic 2 — koreys tili va AI ustoz

Mavjud hangeul-maktabi o‘quv kontenti saqlangan. Yangi glassy-gradient dizayn sayt, PWA va Android TWA’da bir xil ishlaydi. Preview porti 3000.

## Arxitektura

`public/` — brauzer interfeysi va offline kontent; `base.css` oldingi funksional bazani, `premium.css` yangi dizaynni beradi. `runtime-client.js` autentifikatsiya, SSE va bounded PCM player; `tutor-controller.js` mavjud mashq/router kodini server bilan bog‘laydi.

`server/` — Express API, Manus OAuth, MySQL progress va o‘quv catalogi, lease va quota himoyasi. `server/tts/` — Gemini SSE, ElevenLabs WebSocket, Google TTS adapterlari va offline testlar. `android/` — shu saytni Chrome orqali ochadigan TWA; native dizayn alohida takrorlanmaydi.

Production frontend CDNdan, `/api/*` containerdan xizmat oladi. Darslar va statik sahifalar AI yuklamasidan ajratilgan. API kalitlari faqat himoyalangan environmentda; Git, HTML, localStorage yoki APK ichida yo‘q.

## Ishga tushirish

```sh
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
pnpm migrate
node scripts/export-catalog.mjs
pnpm exec tsx server/catalog-seed.ts
pnpm dev
```

Build: `pnpm build`, production: `pnpm start`, offline testlar: `pnpm test`. Yangi database uchun migratsiya va catalog seed bir marta, production publishdan oldin bajariladi. Bu taskdagi boshqariladigan databasega additive migratsiya va seed bajarilgan. Mavjud owner content seed tomonidan overwrite qilinmaydi.

## Yuklama va provider budgeti

Boshlang‘ich sig‘im Gemini 8 active turn, ElevenLabs 2 active turn, har user 1 active turn. MySQL lease’lari restart va bir nechta instance orasida umumiy. Kutish 8 soniya va har resurs uchun 64 queued request bilan cheklangan. API limitlari per-user kunlik/minutlik; voice uchun umumiy va per-user oylik belgi rezervi bor. Timeout, abort va frontend backpressure ishlaydi.

Joriy ElevenLabs Free hisobining 10 000 belgi/oy limiti 500–1000 kishining muntazam tabiiy ovozini ta’minlamaydi. Per-user default voice budgeti 1000 belgi/oy. Tabiiy ovoz band yoki limit tugasa, matnli AI va brauzerning koreyscha ovozi fallback bo‘ladi; browser voice mavjud bo‘lmasa javob matn ko‘rinishida qoladi. Yuqori voice concurrency uchun tarif va production load-test talab qilinadi. Hech qanday pullik tarif avtomatik sotib olinmagan.

`pnpm loadtest` faqat local HTML endpointida 1000 so‘rov/50 parallel HTTP so‘rovni tekshiradi; bu 1000 parallel ovozli user testi emas. Admin metrics faqat `ADMIN_OPEN_IDS` allowlist uchun; latency/circuit telemetry process-local, fleet-wide monitoring emas. Durable quota/lease hisoblari MySQLda.

## Production va Android

`PUBLIC_ORIGIN` haqiqiy publish originiga qo‘yiladi; `ALLOWED_ORIGINS` faqat zarur qo‘shimcha frontendlar uchun. Public-origin headerlarni ichki hostdan yasamang. Session cookie HTTPS uchun SameSite=None; Secure.

App yangi originiga publish bo‘lgandan keyin Android DEFAULT_URL va versiya moslanadi, APK qayta yig‘iladi. Yangi 2.0.1 debug APK https://gotopik-a749akip.manus.space/ URLiga yo‘naltirilgan, lekin signed production release deb hisoblanmaydi. Yangilanish uchun oldingi production keystore zarur. [Android qo‘llanmasi](docs/android-release.md) va [provider tekshiruvlari](docs/provider-notes.md) tafsilotlarni beradi.

Barcha asosiy kontent ro‘yxati 31 mavzu, 90 grammatika yozuvi va 2888 dictionary yozuvidan iborat. Catalog MySQLga saqlangan va public cached JSON fallback ham mavjud.
