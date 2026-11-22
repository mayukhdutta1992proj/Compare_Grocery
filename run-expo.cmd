@echo off
rem Starts the Expo dev server for Expo Go on the iPhone, and restarts it
rem automatically if the internet tunnel drops (Expo's "Unexpected server
rem response: 409" crash). Stop it with Ctrl+C, then answer Y.
cd /d "%~dp0"
:loop
call npx.cmd expo start --tunnel
echo.
echo Expo stopped. Restarting in 5 seconds (press Ctrl+C to quit)...
timeout /t 5 /nobreak >nul
goto loop
