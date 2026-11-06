#Requires -Version 7.0

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpm) {
    throw 'pnpm was not found. Install Node.js and pnpm, then run this script again.'
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
Write-Host "Using Rust installation: $rustupDirectory"
Write-Host "Using Rust toolchain: $rustToolchain"

$nodeModules = Join-Path $projectRoot 'node_modules'
if (-not (Test-Path -LiteralPath $nodeModules)) {
    Write-Host 'Installing project dependencies...'
    & $pnpm.Source install
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

Write-Host 'Starting ProjectSync...'
& $pnpm.Source tauri dev
exit $LASTEXITCODE
