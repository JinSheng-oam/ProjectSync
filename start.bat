@echo off
setlocal

set "PWSH="

:: 1. 优先从环境变量 PATH 中查找 pwsh
for /f "delims=" %%I in ('where.exe pwsh.exe 2^>nul') do (
    if not defined PWSH set "PWSH=%%I"
)

:: 2. 若 PATH 未找到，查找常见安装路径
if not defined PWSH if exist "%ProgramFiles%\PowerShell\7\pwsh.exe" set "PWSH=%ProgramFiles%\PowerShell\7\pwsh.exe"
if not defined PWSH if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe" set "PWSH=%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe"
if not defined PWSH if exist "%LOCALAPPDATA%\Programs\PowerShell\7\pwsh.exe" set "PWSH=%LOCALAPPDATA%\Programs\PowerShell\7\pwsh.exe"
if not defined PWSH if exist "%ProgramFiles(x86)%\PowerShell\7\pwsh.exe" set "PWSH=%ProgramFiles(x86)%\PowerShell\7\pwsh.exe"
if not defined PWSH if exist "%ProgramFiles%\PowerShell\7-preview\pwsh.exe" set "PWSH=%ProgramFiles%\PowerShell\7-preview\pwsh.exe"

if not defined PWSH (
    echo [ERROR] 未找到 PowerShell 7。
    echo 请安装 PowerShell 7 或将其添加至环境变量 PATH。
    echo 推荐安装方式：在终端运行 winget install Microsoft.PowerShell
    echo.
    pause
    exit /b 1
)

"%PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo ProjectSync startup failed with exit code %EXIT_CODE%.
    pause
)

exit /b %EXIT_CODE%
