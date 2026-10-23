@echo off
setlocal EnableExtensions
title COSMIQ Games Launcher
cd /d "%~dp0"

echo.
echo  ==========================================
echo           COSMIQ Classroom Games
echo  ==========================================
echo.

rem --- 1. Find Python (the Microsoft Store stub fails --version, so it is skipped) ---
set "PY="
python --version >nul 2>&1 && set "PY=python"
if not defined PY py --version >nul 2>&1 && set "PY=py"
if not defined PY (
  echo  Python was not found.
  echo  Install it from https://www.python.org/downloads/
  echo  and tick "Add Python to PATH" during setup, then run this file again.
  echo.
  pause
  exit /b 1
)

rem --- 2. Pick a port: reuse our server if it is already running, else the first free one ---
set "PORT="
set "NEED_START=0"
for %%p in (8765 8766 8767 8768 8769) do (
  if not defined PORT call :tryport %%p
)
if not defined PORT (
  echo  Ports 8765-8769 are all in use by other programs. Close one and try again.
  pause
  exit /b 1
)

rem --- 3. Start the server in its own minimised window ---
if "%NEED_START%"=="1" (
  echo  Starting the games server on port %PORT% ...
  start "COSMIQ Games Server - close this window to stop" /min %PY% -m http.server %PORT% --bind 0.0.0.0
  call :waitready
) else (
  echo  The games server is already running on port %PORT%.
)

rem --- 4. Show the addresses and open the browser ---
echo.
echo  On this PC:      http://localhost:%PORT%/games/
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=*" %%b in ("%%a") do echo  On the panel:    http://%%b:%PORT%/games/
)
echo.
echo  The panel must be on the same Wi-Fi / network as this PC.
echo  If Windows Firewall asks about Python, click "Allow access".
echo  To stop the games, close the "COSMIQ Games Server" window.
echo.
start "" "http://localhost:%PORT%/games/"
echo  Opening the games in your browser...
"%SystemRoot%\System32\timeout.exe" /t 8 >nul
exit /b 0


rem ---------------------------------------------------------------------------
:tryport
rem Free port -> use it and start a server on it.
netstat -ano | findstr /r /c:"TCP.*:%1 .*LISTENING" >nul
if errorlevel 1 (
  set "PORT=%1"
  set "NEED_START=1"
  exit /b 0
)
rem Busy port -> only reuse it if it is already serving our games.
for /f %%c in ('curl -s -o nul -w "%%{http_code}" http://localhost:%1/games/shared/ifpd.js 2^>nul') do (
  if "%%c"=="200" (
    set "PORT=%1"
    set "NEED_START=0"
  )
)
exit /b 0

:waitready
rem Wait up to ~10 s for the server to answer.
for /l %%i in (1,1,10) do (
  curl -s -o nul http://localhost:%PORT%/games/ >nul 2>&1 && exit /b 0
  "%SystemRoot%\System32\timeout.exe" /t 1 /nobreak >nul
)
echo  Warning: the server did not answer yet; the page may need a refresh.
exit /b 0
