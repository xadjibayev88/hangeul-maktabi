# Provider cheklovlari va integratsiya ma’lumotlari

2026-11-13 kuni ulangan ElevenLabs connectorining `check_subscription` javobi Free tarif, 10 000 belgi/oy va boshlang‘ich 13 belgi ishlatilganini ko‘rsatdi. Bu 500–1000 kishining muntazam tabiiy ovozini qoplamaydi. Tizim umumiy oylik belgi budgetini MySQLda rezerv qiladi; provider limiti baribir yakuniy manba hisoblanadi. Tarif o‘zgarishi yoki oldindan ishlatilgan kreditlar uchun owner limitni qayta moslashi kerak.

Gemini models API ro‘yxati ayrim eski modellarning metadata’sini qaytaradi, lekin 2026-11-13 haqiqiy `gemini-2.5-flash-lite:generateContent` so‘rovi 404 qaytardi: model yangi foydalanuvchilar uchun mavjud emas. `gemini-3.1-flash-lite:streamGenerateContent?alt=sse` haqiqiy so‘rovi 200 va STOP bilan tugadi. Shuning uchun yangi server defaulti `gemini-3.1-flash-lite`.

Rasmiy thinking qo‘llanmasi `gemini-3.1-flash-lite` defaulti minimal ekanini ko‘rsatadi [1]. Server eski thinkingBudget=0 ni Gemini 3 so‘rovlariga majburan qo‘shmaydi. Kalitlar HTTP header orqali faqat serverdan yuboriladi.

Bir dona kichik haqiqiy smoke-testda Gemini JSON javobi 7353 ms da tugadi. Gemini→ElevenLabs WebSocket pipeline’ida birinchi PCM audio 2024 ms da, audio oqimi 2321 ms da tugadi; 135 976 bayt olindi. Bu bitta sandbox so‘rovi, production p95 yoki 1000 parallel AI foydalanuvchi benchmarki emas.

500–1000 jami foydalanuvchi va 500–1000 bir vaqtdagi ovozli foydalanuvchi boshqa yuklamalar. Hozirgi konservativ start limitlari: Gemini 8 parallel turn, ElevenLabs 2 parallel turn, har user 1 active turn, resurs uchun 64 gacha kutuvchi va 8 soniyagacha kutish. Yuqori concurrency provider tarifi va production load-test natijasidan keyin belgilanadi. Hech bir pullik tarif ushbu taskda sotib olinmagan.

[1]: https://aistudio.google.com/docs/thinking "Gemini thinking: supported levels and defaults"
