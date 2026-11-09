#Requires -Version 7.0

$installer = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$missingTools = 'MSVC x64 build tools were not found. In Visual Studio Installer, install Desktop development with C++ (MSVC x64/x86 and a Windows SDK).'
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
    throw $missingTools
}

$installation = & $installer -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if ($LASTEXITCODE -ne 0 -or -not $installation) {
    throw $missingTools
}

$developerShell = Join-Path $installation 'Common7\Tools\Launch-VsDevShell.ps1'
if (-not (Test-Path -LiteralPath $developerShell -PathType Leaf)) {
    throw $missingTools
}

& $developerShell -Arch amd64 -HostArch amd64 -SkipAutomaticLocation -ErrorAction Stop
$linker = Get-Command link.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $linker -or $linker.Source -notlike '*\VC\Tools\MSVC\*\x64\link.exe') {
    throw 'MSVC initialization did not provide an x64 linker. Repair the C++ workload in Visual Studio Installer.'
}
$libraryPaths = $env:LIB -split ';' | Where-Object { $_ }
foreach ($library in 'kernel32.lib', 'ucrt.lib') {
    $available = $libraryPaths | Where-Object {
        Test-Path -LiteralPath (Join-Path $_ $library) -PathType Leaf
    } | Select-Object -First 1
    if (-not $available) {
        throw "Windows SDK x64 library $library was not found. Add or repair a Windows 10 or 11 SDK in Visual Studio Installer, then rerun this script."
    }
}
Write-Host "Using MSVC linker: $($linker.Source)"
