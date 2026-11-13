# Go Topic 2 release holati

2026-11-13. Birinchi production publication muvaffaqiyatli: `https://gotopik-a749akip.manus.space`, a00e8ccf05be4ce60619c32b7d567383ba69c7df. Manus infra observation Reserved hosting deklaratsiyasi va effective always_on rejimi mosligini ko‘rsatdi. Birinchi publish owner-only; Public tanlovini owner publish kartasida tasdiqlashi kerak. Anonim HTTP 403 shu visibility cheklovidir, backend nosozligi emas.

Haqqoniy production domeni OAuth allowlist va Android DEFAULT_URL’iga ulandi. Yangi Android debug build 2.0.1 (2001) muvaffaqiyatli yig‘ildi, haqiqiy production URL’i va debug sertifikati tekshirildi; Digital Asset Links fingerprinti qo‘shildi. Bu o‘zgarishlar checkpoint va yakuniy publishdan keyin productionga yetadi. Signed release uchun oldingi production keystore kerak.

23 ta offline regression test o‘tdi. Local HTML test: 1000 actual app HTML response, 50 parallel worker, 0 xato, p50 53 ms, p95 94 ms. Bu sandbox HTML server testi, real mijozlar tarmog‘i yoki 1000 parallel AI testi emas.

Haqiqiy kichik Gemini→ElevenLabs WebSocket testida birinchi PCM audio 2024 ms. Free 10 000 belgi/oy uchun global va user 1000 belgi/oy budgeti, 400 belgi turn rezervi, navbat va fallback bor. Gemini 8 parallel turn, ElevenLabs 2 parallel turn boshlang‘ich konfiguratsiya. Owner 500–1000 jami foydalanuvchi ekanini tasdiqladi.

MySQL additive migratsiya va katalog seed bajarilgan: 31 mavzu, 90 grammatika, 2888 dictionary yozuvi. OAuth state/origin, per-user voice budget, provider error attribution, cloud deck union, saved plan preservation va fallback abort muammolari tuzatildi. Telemetry process-local; quota, progress va lease MySQLda durable.
