@echo off
set PORT=8090
powershell -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Port %PORT% -OpenBrowser
