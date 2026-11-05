@echo off
setlocal
set "PWSH=C:\Program Files\PowerShell\7\pwsh.exe"

if not exist "%PWSH%" (
    echo PowerShell 7 was not found at:
    echo "%PWSH%"
    pause
    exit /b 1
)

"%PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-installer.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo ProjectSync installer build failed with exit code %EXIT_CODE%.
)

echo.
pause
exit /b %EXIT_CODE%
