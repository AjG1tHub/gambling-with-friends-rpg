@echo off
rem Double-click to play locally. Opens the Game Lab in your browser.
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8080/lab/
  node tools\serve.mjs 8080
  goto :eof
)
where py >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8080/lab/
  py -m http.server 8080 --bind 127.0.0.1 --directory site
  goto :eof
)
where python >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:8080/lab/
  python -m http.server 8080 --bind 127.0.0.1 --directory site
  goto :eof
)
echo Neither Node.js nor Python was found on this PC.
echo Install Node.js from https://nodejs.org (LTS), then double-click this file again.
pause
