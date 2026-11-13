# Android chiqarish

Go Topic Android ilovasi Chrome orqali Manus’dagi production saytni ochadigan Trusted Web Activity (TWA).

Production manzil: `https://gotopik-a749akip.manus.space/`. Yangi DEFAULT_URL shu haqiqiy publish domeniga ulandi. Sayt Public ruxsatida bo‘lishi kerak; Private sayt 500–1000 foydalanuvchi yoki Android’ning domain-verification so‘rovlariga ochilmaydi.

## Sinov APK

Yangi versiya: 2.0.1, versionCode 2001, applicationId `uz.hangeulmaktabi.app`, compile/target SDK 35, min SDK 23. Bu debug-signed APK, Play Store release emas. Yig‘ilgandan keyin `/home/ubuntu/output/GoTopic-debug.apk` sifatida yetkaziladi.

Saytning `/.well-known/assetlinks.json` faylida aynan shu debug sertifikatining SHA-256 fingerprinti bor. Public sayt va qurilmaning muvaffaqiyatli Digital Asset Links tekshiruvi TWA’da browser chrome’ni yashirishga imkon beradi; qurilma tekshiruvi kechiksa Custom Tabs fallback ochiladi.

Manifestda faqat INTERNET ruxsati bor; mikrofon uchun Chrome o‘zining odatiy Android ruxsatini so‘raydi. Dizayn, ranglar va darslar saytdan keladi.

## Yig‘ish

Android SDK 35 va Gradle 8.9+ o‘rnatilgan muhitda:

```sh
VERSION_CODE=2001 VERSION_NAME=2.0.1 ./scripts/build-android.sh
```

`OUTPUT_DIR` orqali artefact katalogi beriladi. Release signing to‘liq berilmasa, script debug APK yig‘adi. `RELEASE_KEYSTORE_FILE`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD` to‘liq va to‘g‘ri berilsa signed release yig‘iladi.

GitHub Actions faqat manual workflow_dispatch. GitHub secretlari uchun `RELEASE_KEYSTORE_BASE64`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD` ishlatiladi. APK build, signing va release output nomi alohida belgilanadi.

## Rasmiy yangilanish va ma’lumotlar

Eski APK ustiga yangilash uchun aynan oldingi production keystore kerak. Boshqa sertifikatli debug APK update bo‘la olmasligi mumkin; foydalanuvchidan ilovani yoki ma’lumotlarni avtomatik o‘chirish talab qilinmaydi. Production fingerprint assetlinks fayliga qo‘shilishi kerak. Keystore/parollar Git yoki APK manba fayllariga qo‘yilmaydi.

Eski GitHub Pages sahifasi o‘zgartirilmagan va uning Chrome’dagi local progressi o‘sha origin uchun saqlanib qoladi. Yangi Manus originiga localStorage avtomatik ko‘chmaydi. Cloud progress yangi hisob orqali sinxronlanadi; eski origin progressini ko‘chirish alohida migration/export bosqichini talab qiladi. Bu build ma’lumotlarni o‘chirib yoki yashirin ko‘chirmaydi.

SDK 35 kelajakdagi Play siyosatiga moslik kafolati emas. Rasmiy Store release uchun production signing va o‘sha paytdagi Store talablarini tekshirish zarur.
