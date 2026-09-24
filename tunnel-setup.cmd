@echo off
chcp 65001 >nul
:: tunnel-setup.cmd — راه‌اندازی Cloudflare Tunnel برای رادار مناقصات
:: این فایل را یک‌بار اجرا کن؛ بعد tunnel همیشه با run-tunnel.cmd بالا می‌آید.

echo ==========================================
echo  راه‌اندازی Cloudflare Tunnel
echo  رادار مناقصات از هر جا در دسترس
echo ==========================================
echo.

set TUNNEL_DIR=%USERPROFILE%\.cloudflared
if not exist "%TUNNEL_DIR%" mkdir "%TUNNEL_DIR%"

:: ۱) دانلود cloudflared
if not exist "%TUNNEL_DIR%\cloudflared.exe" (
  echo [۱/۴] در حال دانلود cloudflared...
  curl -L -o "%TUNNEL_DIR%\cloudflared.exe" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
  if errorlevel 1 (
    echo خطا در دانلود. دسترسی به اینترنت را چک کنید.
    pause
    exit /b 1
  )
  echo دانلود کامل شد.
) else (
  echo [۱/۴] cloudflared قبلاً دانلود شده.
)

:: ۲) لاگین به Cloudflare
if not exist "%TUNNEL_DIR%\cert.pem" (
  echo.
  echo [۲/۴] لاگین به Cloudflare — مرورگر باز می‌شود...
  echo    اگر مرورگر باز نشد، این لینک را دستی باز کن:
  "%TUNNEL_DIR%\cloudflared.exe" login
  if errorlevel 1 (
    echo خطا در لاگین.
    pause
    exit /b 1
  )
) else (
  echo [۲/۴] قبلاً لاگین کرده‌ای.
)

:: ۳) ساخت tunnel
if not exist "%TUNNEL_DIR%\tender-radar.json" (
  echo.
  echo [۳/۴] ساخت tunnel جدید...
  "%TUNNEL_DIR%\cloudflared.exe" tunnel create tender-radar
  if errorlevel 1 (
    echo خطا در ساخت tunnel.
    pause
    exit /b 1
  )
) else (
  echo [۳/۴] tunnel قبلاً ساخته شده.
)

:: ۴) تنظیم مسیر (local:3731 → public)
echo.
echo [۴/۴] تنظیم مسیر tunnel...
"%TUNNEL_DIR%\cloudflared.exe" tunnel route dns tender-radar radar-tenders.yourdomain.ir 2>nul
echo    ^(دامنه بعداً در داشبورد Cloudflare قابل تغییر است^)

:: ۵) فایل config.yml
echo.
echo در حال ساخت فایل تنظیمات...
(
echo tunnel: tender-radar
echo credentials-file: "%TUNNEL_DIR%\tender-radar.json"
echo ingress:
echo   - hostname: radar-tenders.yourdomain.ir
echo     service: http://localhost:3731
echo   - service: http_status:404
echo   
) > "%TUNNEL_DIR%\config.yml"

echo.
echo ==========================================
echo  راه‌اندازی کامل شد!
echo ==========================================
echo.
echo برای شروع tunnel، دستور زیر را اجرا کن:
echo    %TUNNEL_DIR%\cloudflared.exe tunnel run tender-radar
echo.
echo یا فایل run-tunnel.cmd را دوبار کلیک کن.
echo.
pause
