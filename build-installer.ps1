#Requires -Version 7.0

param([switch]$NsisOnly)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpmCommand) {
    throw 'pnpm was not found. Install Node.js and pnpm, then run this script again.'
}

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules') -PathType Container)) {
    throw 'Project dependencies are missing. Run pnpm install in the project directory first.'
}

$rustupCommand = Get-Command rustup -ErrorAction SilentlyContinue
$rustupPath = if ($rustupCommand) { $rustupCommand.Source } else { $null }
if (-not $rustupPath) {
    $rustupCandidates = @()
    if ($env:CARGO_HOME) {
        $rustupCandidates += Join-Path $env:CARGO_HOME 'bin\rustup.exe'
    }
    if ($env:USERPROFILE) {
        $rustupCandidates += Join-Path $env:USERPROFILE '.cargo\bin\rustup.exe'
    }
    $rustupCandidates += 'D:\Rust\cargo\bin\rustup.exe'
    $rustupPath = $rustupCandidates |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1
}

if (-not $rustupPath) {
    throw 'rustup was not found. Install Rust and a Windows MSVC toolchain.'
}

$rustupDirectory = Split-Path -Parent $rustupPath
$pathEntries = $env:PATH -split [System.IO.Path]::PathSeparator
if ($pathEntries -notcontains $rustupDirectory) {
    $env:PATH = "$rustupDirectory$([System.IO.Path]::PathSeparator)$env:PATH"
}

$toolchains = @(& $rustupPath toolchain list)
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to list installed Rust toolchains.'
}

$toolchainNames = $toolchains | ForEach-Object { ($_ -split '\s+')[0] }
$rustToolchain = $toolchainNames |
    Where-Object { $_ -match '^\d+\.\d+\.\d+-x86_64-pc-windows-msvc$' } |
    Sort-Object { [version]($_ -replace '-x86_64-pc-windows-msvc$', '') } -Descending |
    Select-Object -First 1

if (-not $rustToolchain) {
    $rustToolchain = $toolchainNames |
        Where-Object { $_ -eq 'stable-x86_64-pc-windows-msvc' } |
        Select-Object -First 1
}

if (-not $rustToolchain) {
    throw 'No Windows MSVC Rust toolchain is installed. Install one with: rustup toolchain install stable-x86_64-pc-windows-msvc'
}

$env:RUSTUP_TOOLCHAIN = $rustToolchain
Write-Host "Using Rust toolchain: $rustToolchain"
Write-Host 'Building ProjectSync installers...'

$buildArgs = @('tauri', 'build')
if ($NsisOnly) { $buildArgs += @('--bundles', 'nsis') }
& $pnpmCommand.Source @buildArgs
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$bundleRoot = Join-Path $projectRoot 'src-tauri\target\release\bundle'
$artifactDirectories = @(
    @{ Path = (Join-Path $bundleRoot 'nsis'); Pattern = 'ProjectSync_*_x64-setup.exe' },
    @{ Path = (Join-Path $bundleRoot 'msi'); Pattern = 'ProjectSync_*_x64_en-US.msi' }
)
if ($NsisOnly) { $artifactDirectories = @($artifactDirectories[0]) }
$artifacts = foreach ($directory in $artifactDirectories) {
    $artifact = Get-ChildItem -LiteralPath $directory.Path -File -Filter $directory.Pattern |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $artifact) {
        throw "Tauri build completed without creating $($directory.Pattern) in $($directory.Path)"
    }
    $artifact
}

Write-Host ''
Write-Host 'Installer build completed:'
foreach ($artifact in $artifacts) {
    $file = Get-Item -LiteralPath $artifact
    Write-Host ("{0} ({1:N2} MB)" -f $file.FullName, ($file.Length / 1MB))
}
