param(
    [string]$BackupDir = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

# Same authoritative data-dir logic as the server (config.ts):
# SURVIV_DATA_DIR (e.g. D:\surviv-data) or <projectRoot>\server-data.
$dataDir = $env:SURVIV_DATA_DIR
if ($dataDir -and $dataDir.Trim()) {
    if (-not [System.IO.Path]::IsPathRooted($dataDir.Trim())) {
        $dataDir = Join-Path $projectRoot $dataDir.Trim()
    }
} else {
    $dataDir = Join-Path $projectRoot "server-data"
}
$dataDir = [System.IO.Path]::GetFullPath($dataDir)

$dataFiles = @(
    "survivio-stash.json",
    "survivio-player-accounts.json",
    "survivio-admin-auth.json"
)

$duplicates = @()
foreach ($file in $dataFiles) {
    $dataFile = Join-Path $dataDir $file
    $rootFile = Join-Path $projectRoot $file
    if ((Test-Path -LiteralPath $dataFile) -and (Test-Path -LiteralPath $rootFile)) {
        $duplicates += $file
    }
}

Write-Host "Authoritative data dir: $dataDir" -ForegroundColor Cyan
if ($duplicates.Count -eq 0) {
    Write-Host "No duplicate data files found in the project root." -ForegroundColor Green
    exit 0
}

Write-Host "Duplicate legacy copies in project root: $($duplicates -join ', ')" -ForegroundColor Yellow
Write-Host ""

# Safety: only archive a root copy when the authoritative copy is non-empty
# and NOT older than the root one; otherwise skip and let a human verify.
# Never delete player data directly.
$toMove = @()
foreach ($file in $duplicates) {
    $dataFile = Join-Path $dataDir $file
    $rootFile = Join-Path $projectRoot $file
    $dataItem = Get-Item -LiteralPath $dataFile
    if ($dataItem.Length -le 2) {
        Write-Host "SKIP $file : authoritative copy is empty ($($dataItem.Length) bytes), verify manually." -ForegroundColor Red
        continue
    }
    $rootItem = Get-Item -LiteralPath $rootFile
    if ($dataItem.LastWriteTime -lt $rootItem.LastWriteTime) {
        Write-Host "SKIP $file : authoritative copy is OLDER than the project-root one, verify manually." -ForegroundColor Red
        continue
    }
    $toMove += $file
}

if ($toMove.Count -eq 0) {
    Write-Host "Nothing safe to archive (all skipped); verify the data manually." -ForegroundColor Yellow
    exit 1
}

if (-not $BackupDir) {
    $BackupDir = Join-Path $projectRoot ("backup-duplicate-data-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
}
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

foreach ($file in $toMove) {
    $rootFile = Join-Path $projectRoot $file
    Move-Item -LiteralPath $rootFile -Destination (Join-Path $BackupDir $file) -Force
    Write-Host "Moved  $file  ->  $BackupDir" -ForegroundColor Green
}

Write-Host ""
Write-Host "Done. The server now has a single authoritative data dir: $dataDir" -ForegroundColor Green
Write-Host "Backup kept at: $BackupDir (delete after confirming the server works)" -ForegroundColor Cyan
