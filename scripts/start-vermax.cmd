@echo off
rem Vermax supervisor: runs the API (which also serves the UI) and restarts it if it ever exits.
rem Logs: data\vermax.log   Optional env: create a ".env.cmd" next to this file with "set TELEGRAM_BOT_TOKEN=..." lines.
cd /d "%~dp0.."
if exist "%~dp0.env.cmd" call "%~dp0.env.cmd"
:loop
echo [%date% %time%] starting Vermax >> data\vermax.log
node apps\api\dist\main.js >> data\vermax.log 2>&1
echo [%date% %time%] Vermax exited (code %errorlevel%), restarting in 15s >> data\vermax.log
timeout /t 15 /nobreak > nul
goto loop
