# دسترسی از راه دور (iPhone / هر دستگاه)

## روش سریع: Cloudflare Tunnel (رایگان، همیشه‌روشن)

### یک‌بار — راه‌اندازی
۱. **رادار را اجرا کن:** `node server.mjs` (یا دوبار کلیک روی `run.cmd`)
۲. **Tunnel را نصب کن:** دوبار کلیک روی `tunnel-setup.cmd`
   - دانلود خودکار `cloudflared`
   - لاگین با مرورگر (احراز هویت Cloudflare)
   - ساخت tunnel اختصاصی

### هر بار — استفاده
۱. رادار را بالا بیاور: `node server.mjs`
۲. Tunnel را بالا بیاور: دوبار کلیک روی `run-tunnel.cmd`
۳. در iPhone Safari بزن:
   ```
   https://radar-tenders.yourdomain.ir
   ```
   (دقیقاً همان دامنه‌ای که در داشبورد Cloudflare ثبت کردی)

### دامنهٔ شخصی‌سازی‌شده
اگر دامنهٔ خودت را داری (مثلاً `yourdomain.ir`):
۱. برو به [dash.cloudflare.com](https://dash.cloudflare.com)
۲. تب **Zero Trust** → **Networks** → **Tunnels**
۳. tunnel `tender-radar` را پیدا کن → **Edit**
۴. در **Public Hostname** دامنهٔ واقعی‌ات را بده

### روش جایگزین: ngrok (بدون ثبت‌نام)
```bash
npx ngrok http 3731
```
لینک موقت (مثلاً `https://abc123.ngrok.io`) را روی iPhone باز کن.

### روش محلی: هم‌شبکه
اگر iPhone و کامپیوتر روی یک وای‌فای هستند:
۱. IP کامپیوتر را پیدا کن: `ipconfig` (مثلاً `192.168.1.45`)
۲. در Safari iPhone بزن: `http://192.168.1.45:3731`
