@echo off
setlocal
set "PWSH=C:\Program Files\PowerShell\7\pwsh.exe"
if not exist "%PWSH%" (
    where pwsh.exe >nul 2>nul || (
        echo PowerShell 7 not found.
        exit /b 1
    )
    set "PWSH=pwsh.exe"
)
"%PWSH%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0reinstall.ps1" %*
set "RESULT=%ERRORLEVEL%"
exit /b %RESULT%
