@echo off
rem Adds Vermax to your Windows Startup folder (runs minimised at logon). Undo with uninstall-autostart.cmd
set "TARGET=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Vermax.cmd"
(echo @echo off& echo start "Vermax" /min cmd /c "%~dp0start-vermax.cmd") > "%TARGET%"
echo Installed: %TARGET%
