$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $Root
$env:CI = "true"

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw "Node.js was not found. Install Node.js 22.18.0 or newer."
}
if (-not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) {
    throw "pnpm was not found. Run 'corepack enable pnpm' or install pnpm 11.18.0."
}

$NodeVersionText = (& node.exe -p "process.versions.node").Trim()
if ([version]$NodeVersionText -lt [version]"22.18.0") {
    throw "Node.js 22.18.0 or newer is required (found $NodeVersionText)."
}

Write-Host "[1/3] Installing the pnpm workspace from the frozen lockfile..."
& pnpm.cmd install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "Workspace dependency installation failed." }

Write-Host "[2/3] Building the Rolldown server entries and Vite client..."
& pnpm.cmd build
if ($LASTEXITCODE -ne 0) { throw "Workspace build failed." }

Write-Host "[3/3] Verifying deployable entry points..."
$RequiredOutputs = @(
    "server\dist\gameServer.js",
    "server\dist\gameProcess.js",
    "server\dist\smartBot.js",
    "server\dist\index.js",
    "client\dist\index.html",
    "client\dist\admin\index.html"
)
$MissingOutputs = @($RequiredOutputs | Where-Object {
        -not (Test-Path -LiteralPath (Join-Path $Root $_) -PathType Leaf)
    })
if ($MissingOutputs.Count -gt 0) {
    throw "Build is incomplete. Missing: $($MissingOutputs -join ', ')"
}

Write-Host "Build completed. Runtime configuration and server-data were left untouched." -ForegroundColor Green
Write-Host "Start locally with .\start-surviv.cmd (homepage/API/game ports 8001/8000/3000; rooms 9000-9063)."
