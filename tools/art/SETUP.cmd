@echo off
title GWF art pipeline setup
cd /d "%~dp0..\.."
powershell -NoLogo -ExecutionPolicy Bypass -File tools\art\setup.ps1
echo.
echo ---- setup finished (close this window) ----
pause
