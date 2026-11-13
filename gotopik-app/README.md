# Go Topic — Android ilova (AdMob bilan)

Capacitor ilovasi Go Topic saytini ochadi va unga quyidagilarni beradi:
- **AdMob** banneri (pastda, jonli suhbat paytida yashiriladi);
- telefonning o'z **ovozni tanish** xizmati (mikrofon) va **koreyscha ovozi** — oddiy Android WebView'da bular yo'q.

APK GitHub Actions'da yig'iladi: *Actions → "Go Topic APK (AdMob)" → Run workflow*. Natija: Releases'dagi `GoTopic-AdMob.apk`.

Sozlamalar (Run workflow oynasida):
- `site_url` — sayt manzili (domen ulangach o'zgartiring);
- `admob_app_id` — AdMob'dagi **App ID** (`ca-app-pub-…~…`). Bo'sh bo'lsa Google'ning sinov ID'si ishlatiladi.

Banner ID (`ca-app-pub-…/…`) saytdagi `public/ads-config.js` → `admobBanner` ga yoziladi; ilovani qayta yig'ish shart emas.

Saytda `public/native-bridge.js` va yangilangan `public/ads.js` bo'lishi kerak (Go Topic v5 zip).
