# Android chiqarish

Go Topic Android ilovasi Chrome orqali GitHub Pages sayti bilan ishlaydigan Trusted Web Activity (TWA). Hozirgi manzil ataylab o'zgartirilmagan:

`https://xadjibayev88.github.io/hangeul-maktabi/`

Yangi rasmiy domen haqiqatan chop etilgandan keyingina `android/app/src/main/AndroidManifest.xml` ichidagi `DEFAULT_URL` va kerak bo'lsa sayt konfiguratsiyasi birgalikda yangilanadi. Hash asosidagi mavjud bo'lim havolalari (`#bosh`, `#alifbo`, `#sozlar` va boshqalar) o'zgartirilmaydi.

## Mahalliy yig'ish

Android SDK, SDK Platform 35 va Gradle 8.9+ mavjud bo'lsa:

```bash
./scripts/build-android.sh
```

Versiyani sayt versiyasidan mustaqil berish mumkin:

```bash
VERSION_CODE=12 VERSION_NAME=1.0.12 ./scripts/build-android.sh
```

To'liq release signing sozlanmagan bo'lsa, skript aniq nomlangan `output/GoTopic-debug.apk` yaratadi. Bu APK debug sertifikati bilan imzolanadi. Bir xil telefonda eski debug sertifikatli APK ustiga boshqa muhitda yaratilgan APK o'rnatilmasa, bu kutiladigan sertifikat mos kelmasligi xatosi; foydalanuvchi ma'lumotlarini saqlaydigan yangilanishlar uchun doim bitta production keystore kerak.

## GitHub Actions

`.github/workflows/apk.yml` faqat `workflow_dispatch` orqali ishga tushadi; oddiy push yoki tashqi trigger APK chiqarishni boshlamaydi. Workflow mavjud ochiq release/artifact jarayonini saqlaydi:

- barcha to'rt secret bo'lmasa, `GoTopic-debug.apk` yig'iladi va debug deb belgilanadi;
- quyidagi to'rt secret to'liq berilsa, `GoTopic-release.apk` yig'iladi:
  - `RELEASE_KEYSTORE_BASE64`
  - `RELEASE_STORE_PASSWORD`
  - `RELEASE_KEY_ALIAS`
  - `RELEASE_KEY_PASSWORD`
- keystore vaqtinchalik runner fayliga yoziladi, secretlar buyruq satriga chiqarilmaydi va logga yozilmaydi;
- APK artifact sifatida yuklanadi va mavjud public release oqimiga biriktiriladi.

Production keystore va parollar repozitoriyga kiritilmaydi. Signing sozlanmagan debug APK Play Store uchun production release hisoblanmaydi. `compileSdk` va `targetSdk` hozircha 35 qilib belgilangan; bu kelajakdagi Play siyosati bilan moslik kafolati emas.

## Ruxsatlar va TWA xulqi

Manifestda faqat TWA uchun zarur `INTERNET` ruxsati bor. Media/mikrofon kabi xavfli ruxsatlar qo'shilmagan: Chrome sayt so'rovini o'zining odatiy Android ruxsat oqimi orqali boshqaradi. TWA sayt dizaynini o'z ichiga olmaydi — ranglar va ekranlar saytdan keladi.

`public/sw.js` faqat bir xil originning cheklangan shell/static resurslarini keshlaydi. API, auth/private yo'llar, Firebase konfiguratsiyasi, cross-origin resurslar va muvaffaqiyatsiz HTTP javoblar keshlanmaydi. Offline fallback faqat HTML navigatsiyasi uchun ishlaydi; voice-call paytida sahifani majburan qayta yuklamaslik uchun service worker faqat yangilanish xabarini yuboradi.
