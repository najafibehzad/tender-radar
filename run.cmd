@echo off
chcp 65001 >nul
title رادار مناقصات
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js نصب نيست. از nodejs.org نسخه LTS را نصب کنيد.
  echo.
  pause
  exit /b 1
)

echo.
echo   رادار مناقصات — در حال راه‌اندازي ...
echo   http://127.0.0.1:3731
echo.

start "" http://127.0.0.1:3731
node server.mjs

pause
