@echo off
rem watchdog for tender-radar webapp (port 3731) - runs hidden via Task Scheduler
setlocal
set HOST=0.0.0.0
set RADAR=C:\Users\behzad\tender-radar
set NODE=C:\Users\behzad\AppData\Local\hermes\node\node.exe
set LOG=%RADAR%\watchdog.log
curl -s --max-time 5 -o nul http://127.0.0.1:3731/
if %errorlevel%==0 exit /b 0
echo %date% %time% DOWN - reviving >> "%LOG%"
cd /d "%RADAR%"
powershell -NoProfile -Command "Start-Process -FilePath '%NODE%' -ArgumentList 'server.mjs' -WorkingDirectory '%RADAR%' -WindowStyle Hidden"
echo %date% %time% REVIVE-ISSUED >> "%LOG%"
endlocal
