@echo off
setlocal
set "PWSH=C:\Program Files\PowerShell\7\pwsh.exe"
if not exist "%PWSH%" (
    echo PowerShell 7 not found: "%PWSH%"
    pause
    exit /b 1
)
"%PWSH%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0reinstall.ps1" %*
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%
