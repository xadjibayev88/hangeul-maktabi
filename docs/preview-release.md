# Go Topic — yangi Preview versiyasi

2026-11-13. Owner yangi versiyani avval Preview’da tekshirishni tanladi; production publication bajarilmaydi va mavjud published sayt almashtirilmaydi.

Yangi fonlar: sahifaga qarab o‘zgaradigan statik mesh/aurora gradientlar, rangli geometric halqalar, mobil light/dark menyu. Katta blur yo‘q. Nav elementlari flex qisqarishidan saqlangan va matnni fon orqali ko‘rsatib yuboradigan shaffof light drawer tuzatildi.

Lug‘at: Kaikki/English Wiktionary’dan 30 000 noyob koreyscha bosh so‘z. Bu koreys tilidagi barcha so‘zlar yoki rasmiy TOPIK lug‘ati degani emas. O‘zbekcha AI izohlarining haqiqiy qamrovi `/api/dictionary-stats`da ko‘rsatiladi; ishonchsiz tarjima o‘rnida asl inglizcha ma’no saqlanadi. Litsenziya CC BY-SA 4.0; har bir yozuvda manba havolasi bor.

Mashqlar: 9 198 variant — 216 mualliflik vazifasi va mavjud lug‘at asosidagi 8 982 deterministik variant. TOPIK 1–6, har bir bosqich va mavzu. Bu rasmiy imtihon savollari emas. Obyektiv savollar tekshiriladi; yozish/gapirish o‘zini baholash va ixtiyoriy AI izohi bo‘lib, rasmiy ball yoki fonema skori berilmaydi.

Tezlik: lug‘at serverda indeksli qidiriladi va browserga odatda 24 yozuv qaytadi. Mashq ro‘yxati 10 kartadan sahifalanadi, to‘liq 30 ming yozuv browserga yuborilmaydi. Mashq generatsiyasi bounded candidate window va checksum cache’dan foydalanadi. Hisoblash o‘lchovlari `learning-statistics.json`da — bu haqiqiy telefon FPS kafolati emas.

26 regression testi va TypeScript typecheck o‘tdi. TOPIK 6 primeri, barcha uchta mualliflik mavzusi va stale TOPIK 5 shell/manifest yozuvlari moslashtirildi.

Production APK hozirgi published domenni ochadi; Preview dizayni unga publish ruxsati berilmaguncha chiqmaydi. Release-signing uchun production keystore hali kerak; mavjud APK debug sinov imzosi bilan.

## Yakuniy lug‘at qamrovi

Bazaga 30 000 noyob bosh so‘z to‘liq yuklandi. 29 280 yozuvda o‘zbekcha izoh bor; 720 yozuvda ishonchli AI izohi o‘rniga asl inglizcha ma’no saqlanadi. 30 000 tarjima-status yozuvi ham tayyor. Izohlar rasmiy yoki to‘liq inson tekshirgan tarjima deb ko‘rsatilmaydi.

Ko‘p yozuvli eski lug‘at ham 240 DOM qator bilan cheklangan; yangi katta lug‘at 24 qatorli sahifalash orqali ishlaydi. Warm-cache mahalliy read-only testda 2–4 ms; cache’siz namunalar 116–164 ms — bu telefon FPSi yoki barcha tashqi tarmoq holatlari kafolati emas.
