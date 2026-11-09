#Requires -Version 7.0

[CmdletBinding(SupportsShouldProcess)]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-ProjectSyncStopped {
    if (Get-Process -Name projectsync -ErrorAction SilentlyContinue) {
        throw 'ProjectSync 仍在运行。请等同步结束，从系统托盘退出后再重试。'
    }
}

try {
    $uninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall'
    $registryRoots = @("HKCU:\$uninstallKey", "HKLM:\$uninstallKey",
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
    $registrations = @(foreach ($registryRoot in $registryRoots) {
        if (-not (Test-Path -LiteralPath $registryRoot)) { continue }
        foreach ($key in Get-ChildItem -LiteralPath $registryRoot) {
            if ($key.GetValue('DisplayName') -eq 'ProjectSync') { $key }
        }
    })
    foreach ($entry in $registrations) {
        Write-Host ("检测到：{0} · 版本 {1} · {2}" -f $entry.Name, $entry.GetValue('DisplayVersion'), $entry.GetValue('InstallLocation'))
    }
    if ($registrations.Count -gt 1) {
        throw '检测到多条 ProjectSync 安装记录。请在 Windows「已安装的应用」中确认要修复的那一项。'
    }

    if ($registrations.Count -eq 1) {
        $entry = $registrations[0]
        if ($entry.GetValue('WindowsInstaller') -eq 1) {
            $productCode = [guid]::Empty
            if (-not [guid]::TryParseExact($entry.PSChildName, 'B', [ref]$productCode)) {
                throw 'MSI 安装记录缺少有效的产品代码。请使用原 MSI 安装包修复。'
            }
            $target = $productCode.ToString('B')
            if (-not $PSCmdlet.ShouldProcess($target, '修复已安装的 MSI 版本（不升级）')) { return }
            Assert-ProjectSyncStopped
            $result = Start-Process -FilePath (Join-Path ([Environment]::SystemDirectory) 'msiexec.exe') -ArgumentList @('/fa', $target, '/passive', '/norestart') -Wait -PassThru
            if ($result.ExitCode -notin 0, 3010) {
                throw "MSI 修复失败（退出码 $($result.ExitCode)）。如果缺少安装源，请使用原 MSI 安装包。"
            }
            if ($result.ExitCode -eq 3010) {
                Write-Host 'MSI 修复已完成，需重启 Windows。'
            } else {
                Write-Host 'MSI 修复已完成，版本未升级。'
            }
            return
        }
        if ($entry.Name -ne "HKEY_CURRENT_USER\$uninstallKey\ProjectSync") {
            throw '检测到非当前用户的 NSIS 安装或未知安装记录。请使用对应范围的原安装包。'
        }
    }

    $config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
    $version = [version]$config.version
    $bundleDir = Join-Path $PSScriptRoot 'src-tauri\target\release\bundle\nsis'
    $installerPath = Join-Path $bundleDir ('ProjectSync_{0}_x64-setup.exe' -f $version)

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
    if (-not $PSCmdlet.ShouldProcess($installerPath, '使用已有 NSIS 安装包安装 ProjectSync')) { return }

    Assert-ProjectSyncStopped
    $installer = Get-Item -LiteralPath $installerPath -ErrorAction SilentlyContinue
    if (-not $installer -or $installer.PSIsContainer -or $installer.Length -eq 0) {
        throw "未找到可用的 NSIS 安装包：$installerPath。请先准备安装包，再运行此脚本。"
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
