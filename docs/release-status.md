# Go Topic 2 release holati

2026-11-13. Yangi responsive glassy-gradient sayt Previewda ishga tushgan; eski GitHub Pages hozircha o‘zgartirilmagan. Backend kalitlari protected environmentda kiritilgan, MySQL migratsiya va 31 mavzu/90 grammatika/2888 dictionary yozuvli catalog seed bajarilgan.

Local HTML load-test actual `tutor-controller.js` markerini har bir response uchun tekshirdi: 1000 HTTP so‘rov, 50 parallel worker, 0 xato, 1234 ms umumiy vaqt, p50 53 ms, p95 94 ms. Bu sandbox HTML server testi; real mijozlar tarmog‘i, production hosting yoki 1000 parallel AI/ovozli suhbat testi emas.

Haqiqiy kichik Gemini→ElevenLabs WebSocket testida birinchi PCM audio 2024 ms. Provider Free hisobining 10 000 belgi/oy limiti uchun global budget, user 1000 belgi/oy, 400 belgi turn rezervi va fallback mavjud. Gemini 8 parallel turn, ElevenLabs 2 parallel turn boshlang‘ich konfiguratsiya. 500–1000 jami user va 500–1000 active voice bir xil sig‘im emas.

Kod auditida topilgan OAuth redirect/state, per-user voice budget, Gemini/ElevenLabs xato attributioni, cloud decklar union’i va fallback abort muammolari tuzatildi. Turli lokal/cloud rejalar saqlangan rejalar sifatida yo‘qotilmasdan qoladi. Migration fresh database uchun bir martalik deployoldi command; telemetry process-local, durable quota/lease MySQLda.

Debug APK yig‘ildi, lekin eski GitHub Pages URLiga yo‘naltirilgan. Production publish tasdiqlangach yangi origin, Android version va DEFAULT_URL moslanishi kerak. Signed production update uchun oldingi keystore kerak. To‘liq production publication va Android release holati tayyor deb ko‘rsatilmaydi.
