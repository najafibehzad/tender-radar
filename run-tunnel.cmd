@echo off
chcp 65001 >nul
:: run-tunnel.cmd — اجرای Cloudflare Tunnel برای رادار مناقصات
:: مطمئن شوید رادار (node server.mjs) قبلاً روی پورت ۳۷۳۱ بالاست.

set TUNNEL_DIR=%USERPROFILE%\.cloudflared

if not exist "%TUNNEL_DIR%\cloudflared.exe" (
  echo ابتدا tunnel-setup.cmd را اجرا کنید.
  pause
  exit /b 1
)

echo در حال اتصال tunnel...
echo اگر مرورگر iPhone باز است، نشانی خودکار به‌روز می‌شود.
echo Ctrl+C برای قطع.
echo.
"%TUNNEL_DIR%\cloudflared.exe" tunnel run tender-radar
