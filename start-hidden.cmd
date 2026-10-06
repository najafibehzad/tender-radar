@echo off
rem start-hidden.cmd — راه‌انداز بی‌پنجرهٔ رادار مناقصات (پورت ۳۷۳۱)
rem استفاده: دوبار کلیک، یا از خط فرمان: start-hidden.cmd
chcp 65001 >nul
cd /d "%~dp0"
set HOST=0.0.0.0
set PORT=3731
start "TenderRadar" /min cmd /c "node server.mjs >> server.log 2>&1"
exit /b 0
