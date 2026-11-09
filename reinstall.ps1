#Requires -Version 7.0

[CmdletBinding(SupportsShouldProcess)]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

try {
    $config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
    $version = [version]$config.version
    $bundleDir = Join-Path $PSScriptRoot 'src-tauri\target\release\bundle\nsis'
    $installerPath = Join-Path $bundleDir ('ProjectSync_{0}_x64-setup.exe' -f $version)

    $uninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall'
    $registryRoots = @("HKCU:\$uninstallKey", "HKLM:\$uninstallKey",
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
    foreach ($registryRoot in $registryRoots) {
        if (-not (Test-Path -LiteralPath $registryRoot)) { continue }
        foreach ($key in Get-ChildItem -LiteralPath $registryRoot) {
            if ($key.GetValue('DisplayName') -ne 'ProjectSync') { continue }
            if ($key.GetValue('WindowsInstaller') -eq 1 -or $registryRoot -ne $registryRoots[0] -or
                $key.PSChildName -ne 'ProjectSync') {
                throw '检测到 MSI 或其他安装范围的 ProjectSync。请使用原安装包修复，避免混装。'
            }
        }
    }

    $installedKey = Join-Path $registryRoots[0] 'ProjectSync'
    if (Test-Path -LiteralPath $installedKey) {
        $installedVersion = (Get-Item -LiteralPath $installedKey).GetValue('DisplayVersion')
        $parsedVersion = $null
        if (-not [version]::TryParse($installedVersion, [ref]$parsedVersion) -or
            $version -lt $parsedVersion) {
            throw "现有版本为 $installedVersion，无法安全使用版本 $($version) 的安装包覆盖。"
        }
    }

    Write-Host "安装包：$installerPath"
    if (-not $PSCmdlet.ShouldProcess($installerPath, '从当前源码打包并静默覆盖安装 ProjectSync')) { return }

    if (Get-Process -Name projectsync -ErrorAction SilentlyContinue) {
        throw 'ProjectSync 仍在运行。请等同步结束，从系统托盘退出后再重试。'
    }

    $buildStarted = [DateTime]::UtcNow
    & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-installer.ps1') -NsisOnly
    if ($LASTEXITCODE -ne 0) {
        throw "打包失败（退出码 $LASTEXITCODE），已停止安装。"
    }
    $installer = Get-Item -LiteralPath $installerPath -ErrorAction SilentlyContinue
    if (-not $installer -or $installer.PSIsContainer -or $installer.Length -eq 0 -or
        $installer.LastWriteTimeUtc -lt $buildStarted) {
        throw "未找到本次构建生成的安装包：$installerPath"
    }
    if (Get-Process -Name projectsync -ErrorAction SilentlyContinue) {
        throw '打包期间 ProjectSync 已启动。请等同步结束并从托盘退出后再重试。'
    }

    $result = Start-Process -FilePath $installerPath -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
    if ($result.ExitCode -ne 0) {
        throw "安装程序退出码：$($result.ExitCode)。"
    }

    $registration = Get-Item -LiteralPath $installedKey
    $location = ([string]$registration.GetValue('InstallLocation')).Trim('"')
    if (-not $location -or $registration.GetValue('DisplayVersion') -ne $version.ToString() -or
        -not (Test-Path -LiteralPath (Join-Path $location 'projectsync.exe') -PathType Leaf)) {
        throw '安装程序已退出，但无法确认安装版本或程序文件。'
    }
    Write-Host "ProjectSync $($version) 安装完成：$location"
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
