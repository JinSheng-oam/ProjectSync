#Requires -Version 7.0

[CmdletBinding(SupportsShouldProcess)]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Stop-InstalledProjectSync([string]$InstallLocation) {
    $processes = @(Get-Process -Name projectsync -ErrorAction SilentlyContinue)
    if (!$processes.Count) { return }
    if (!$InstallLocation) { throw '无法确认运行中的 ProjectSync 属于本次安装，请先从托盘退出。' }
    $expectedPath = [IO.Path]::GetFullPath((Join-Path $InstallLocation 'projectsync.exe'))
    $installed = @($processes | Where-Object { $_.Path -eq $expectedPath })
    if ($installed.Count -ne $processes.Count) {
        throw '检测到其他位置的 ProjectSync 实例，请先退出后再重试。'
    }

    # Closing the main window only hides it to the tray. Request a Windows
    # shutdown for the exact installed processes, without the force flag.
    if (-not ('ProjectSyncRestartManager' -as [type])) {
        Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class ProjectSyncRestartManager {
    [StructLayout(LayoutKind.Sequential)]
    private struct UniqueProcess {
        public uint Id;
        public System.Runtime.InteropServices.ComTypes.FILETIME Started;
    }

    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    private static extern int RmStartSession(out uint session, int flags, StringBuilder key);
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
    private static extern int RmRegisterResources(uint session, uint files, IntPtr names,
        uint count, [In] UniqueProcess[] processes, uint services, IntPtr serviceNames);
    [DllImport("rstrtmgr.dll")]
    private static extern int RmShutdown(uint session, uint flags, IntPtr callback);
    [DllImport("rstrtmgr.dll")]
    private static extern int RmEndSession(uint session);

    private static void Check(int result) {
        if (result != 0) throw new Win32Exception(result);
    }

    public static void Shutdown(Process[] processes) {
        var targets = new UniqueProcess[processes.Length];
        for (int i = 0; i < processes.Length; i++) {
            long started = processes[i].StartTime.ToFileTimeUtc();
            targets[i].Id = (uint)processes[i].Id;
            targets[i].Started.dwLowDateTime = unchecked((int)started);
            targets[i].Started.dwHighDateTime = (int)(started >> 32);
        }
        Check(RmStartSession(out uint session, 0, new StringBuilder(33)));
        try {
            Check(RmRegisterResources(session, 0, IntPtr.Zero,
                (uint)targets.Length, targets, 0, IntPtr.Zero));
            Check(RmShutdown(session, 0, IntPtr.Zero));
        } finally {
            RmEndSession(session);
        }
    }
}
"@
    }

    Write-Host '正在请求 ProjectSync 退出…'
    try {
        [ProjectSyncRestartManager]::Shutdown([Diagnostics.Process[]]$installed)
        foreach ($process in $installed) {
            if (-not $process.WaitForExit(5000)) { throw '等待进程退出超时。' }
        }
    } catch {
        throw "无法自动关闭 ProjectSync。请从托盘退出后再重试。$($_.Exception.Message)"
    }
    if (Get-Process -Name projectsync -ErrorAction SilentlyContinue) {
        throw 'ProjectSync 在退出后重新启动，已停止安装。'
    }
}

function Get-ProjectSyncRegistration([string[]]$RegistryRoots) {
    foreach ($root in $RegistryRoots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        foreach ($key in Get-ChildItem -LiteralPath $root) {
            if ($key.GetValue('DisplayName') -eq 'ProjectSync') { $key }
        }
    }
}

try {
    $uninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall'
    $registryRoots = @("HKCU:\$uninstallKey", "HKLM:\$uninstallKey",
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
    $registrations = @(Get-ProjectSyncRegistration $registryRoots)
    foreach ($entry in $registrations) {
        Write-Host ("检测到：{0} · 版本 {1} · {2}" -f $entry.Name, $entry.GetValue('DisplayVersion'), $entry.GetValue('InstallLocation'))
    }
    if ($registrations.Count -gt 1) {
        throw '检测到多条 ProjectSync 安装记录。请在 Windows「已安装的应用」中确认要修复的那一项。'
    }

    $config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
    $version = [version]$config.version
    $isMsi = $false
    $installLocation = ''
    if ($registrations.Count -eq 1) {
        $entry = $registrations[0]
        $isMsi = $entry.GetValue('WindowsInstaller') -eq 1
        if ($isMsi) {
            $productCode = [guid]::Empty
            if (-not [guid]::TryParseExact($entry.PSChildName, 'B', [ref]$productCode) -or
                $entry.Name -notlike 'HKEY_LOCAL_MACHINE\*') {
                throw '安装记录不是可识别的系统范围 MSI，请使用对应范围的安装包。'
            }
        } elseif ($entry.Name -ne "HKEY_CURRENT_USER\$uninstallKey\ProjectSync") {
            throw '检测到非当前用户的 NSIS 安装或未知安装记录。请使用对应范围的安装包。'
        }
        $installedVersion = [string]$entry.GetValue('DisplayVersion')
        $parsedVersion = $null
        if (-not [version]::TryParse($installedVersion, [ref]$parsedVersion) -or $version -lt $parsedVersion) {
            throw "现有版本为 $installedVersion，无法安全使用版本 $version 的安装包覆盖。"
        }
        $installLocation = ([string]$entry.GetValue('InstallLocation')).Trim('"')
        if (-not [IO.Path]::IsPathFullyQualified($installLocation)) {
            throw '无法确认现有安装目录，已停止重装。'
        }
        $installLocation = [IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetFullPath($installLocation))
    }

    $bundleDir = Join-Path $PSScriptRoot 'src-tauri\target\release\bundle'
    $bundleFile = if ($isMsi) { "msi\ProjectSync_${version}_x64_en-US.msi" } else { "nsis\ProjectSync_${version}_x64-setup.exe" }
    $installerPath = Join-Path $bundleDir $bundleFile
    $buildOption = if ($isMsi) { '-MsiOnly' } else { '-NsisOnly' }
    if (-not $PSCmdlet.ShouldProcess($installerPath, '从当前源码重新打包，关闭 ProjectSync 后安装')) { return }

    $buildStarted = [DateTime]::UtcNow
    & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-installer.ps1') $buildOption
    if ($LASTEXITCODE -ne 0) { throw "打包失败（退出码 $LASTEXITCODE），已停止安装。" }
    $installer = Get-Item -LiteralPath $installerPath -ErrorAction SilentlyContinue
    if (-not $installer -or $installer.PSIsContainer -or $installer.Length -eq 0 -or
        $installer.LastWriteTimeUtc -lt $buildStarted) {
        throw "未找到本次构建生成的安装包：$installerPath"
    }

    Stop-InstalledProjectSync $installLocation
    if ($isMsi) {
        $msiArgs = @('/i', ('"{0}"' -f $installerPath), '/passive', '/norestart',
            ('INSTALLDIR="{0}"' -f $installLocation))
        $result = Start-Process -FilePath (Join-Path ([Environment]::SystemDirectory) 'msiexec.exe') -ArgumentList $msiArgs -Wait -PassThru
    } else {
        $result = Start-Process -FilePath $installerPath -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
    }
    if ($isMsi -and $result.ExitCode -eq 3010) {
        Write-Host 'MSI 安装已完成，需重启 Windows 后生效。'
        return
    }
    if ($result.ExitCode -ne 0) { throw "安装程序退出码：$($result.ExitCode)。" }

    $installed = @(Get-ProjectSyncRegistration $registryRoots)
    if ($installed.Count -ne 1 -or ($installed[0].GetValue('WindowsInstaller') -eq 1) -ne $isMsi) {
        throw '安装程序已退出，但无法确认唯一且匹配的安装记录。'
    }
    $location = ([string]$installed[0].GetValue('InstallLocation')).Trim('"')
    if (-not $location -or $installed[0].GetValue('DisplayVersion') -ne $version.ToString() -or
        -not (Test-Path -LiteralPath (Join-Path $location 'projectsync.exe') -PathType Leaf) -or
        ($installLocation -and [IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetFullPath($location)) -ne $installLocation)) {
        throw '安装程序已退出，但无法确认安装目录、版本或程序文件。'
    }
    Write-Host "ProjectSync $version 安装完成：$location"
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
