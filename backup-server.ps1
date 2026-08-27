<#
  backup-server.ps1 - 服务器数据备份

  用法：
    .\backup-server.ps1               不停服备份（核心 json + 崩溃日志 + 已完成的 AI 录像）
    .\backup-server.ps1 -StopFirst    先停止服务器再完整备份（含正在录制的录像，最可靠）

  说明：
  - 不停服模式下：
    * survivio-*.json 写入瞬间短暂占用 → 自动重试；
    * AI 录像只复制"已完成"（.jsonl/.json），正在录制的 .part 跳过，
      下次备份时它已改名为 .jsonl 会被自动补上（最终一致）；
    * crash-logs\launcher.log 由启动器持续写入 → 跳过（其余 crash 日志可复制）。
#>
param(
    [switch]$StopFirst
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $projectRoot "backups\server-backup-$stamp"

function Test-Port {
    param([int]$Port)
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $result = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        if (-not $result.AsyncWaitHandle.WaitOne(300)) { return $false }
        $client.EndConnect($result)
        return $true
    } catch { return $false }
    finally { $client.Dispose() }
}

function Wait-PortFree {
    param([int]$Port)
    for ($i = 0; $i -lt 40; $i++) {
        if (-not (Test-Port $Port)) { return }
        Start-Sleep -Milliseconds 500
    }
    throw "端口 $Port 未能在 20 秒内释放"
}

# ---- 停服备份：关闭新版客户端/API/游戏服务进程 ----
if ($StopFirst) {
    Write-Host "正在停止服务器（3000/8000/8001）..." -ForegroundColor Yellow
    foreach ($port in 3000, 8000, 8001) {
        if (Test-Port $port) {
            $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
            foreach ($c in $conn) {
                Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
            }
            Wait-PortFree $port
        }
    }
    Write-Host "服务器已停止。" -ForegroundColor Green
}

New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

# ---- 数据目录解析：优先 SURVIV_DATA_DIR，否则 server-data/ ----
$envDataDir = $env:SURVIV_DATA_DIR
if ($envDataDir -and $envDataDir.Trim()) {
    if (-not [System.IO.Path]::IsPathRooted($envDataDir.Trim())) {
        $envDataDir = Join-Path $projectRoot $envDataDir.Trim()
    }
    $dataDir = $envDataDir
} else {
    $dataDir = Join-Path $projectRoot "server-data"
}
Write-Host "数据目录: $dataDir" -ForegroundColor Cyan

# ---- 带重试的核心文件复制（避开写入瞬间） ----
# 运行数据（玩家账号/仓库/后台凭据）从数据目录读取；配置文件从项目根目录读取。
$runtimeFiles = @("survivio-player-accounts.json", "survivio-stash.json", "survivio-admin-auth.json")
$configFiles  = @("survivio-config.json", "survev-config.hjson", ".env")
$manifest = @()

foreach ($file in @($runtimeFiles + $configFiles)) {
    if ($runtimeFiles -contains $file) {
        # 运行数据：数据目录优先；未迁移前回退项目根目录并提示。
        $src = Join-Path $dataDir $file
        if (-not (Test-Path -LiteralPath $src)) {
            $legacy = Join-Path $projectRoot $file
            if (Test-Path -LiteralPath $legacy) {
                Write-Warning "数据目录缺少 $file，回退备份项目根目录旧副本（$legacy）。建议启动新版本触发自动迁移。"
                $src = $legacy
            } else {
                Write-Warning "跳过缺失文件: $file"
                continue
            }
        }
    } else {
        $src = Join-Path $projectRoot $file
        if (-not (Test-Path -LiteralPath $src)) {
            Write-Warning "跳过缺失文件: $src"
            continue
        }
    }
    $dst = Join-Path $backupRoot $file
    $copied = $false
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        try {
            Copy-Item -LiteralPath $src -Destination $dst -Force -ErrorAction Stop
            $copied = $true
            break
        } catch {
            if ($attempt -ge 5) {
                Write-Warning "无法复制 $file（可能正被写入）。建议停服后备份：.\backup-server.ps1 -StopFirst"
            } else {
                Start-Sleep -Milliseconds 800
            }
        }
    }
    if ($copied) {
        # ---- 校验：大小 + JSON 可解析 + SHA-256 ----
        $item = Get-Item -LiteralPath $dst
        $hash = (Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash
        $jsonOk = "n/a"
        if ($file -like "*.json") {
            try {
                $null = Get-Content -LiteralPath $dst -Raw -Encoding UTF8 | ConvertFrom-Json
                $jsonOk = "ok"
            } catch {
                $jsonOk = "FAILED"
                Write-Warning "备份文件 JSON 解析失败: $file"
            }
        }
        $manifest += [pscustomobject]@{
            file   = $file
            source = $src
            size   = $item.Length
            sha256 = $hash
            json   = $jsonOk
            time   = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
        }
        Write-Host "已备份: $file ($($item.Length) bytes, $hash)" -ForegroundColor Green
    }
}

# 备份清单
$manifestPath = Join-Path $backupRoot "manifest.json"
$manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding UTF8
Write-Host "备份清单: $manifestPath" -ForegroundColor Cyan
function Copy-TreeExcludingPart {
    param([string]$Src, [string]$Dst)
    Get-ChildItem -Path $Src -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -ne ".part" } |
        ForEach-Object {
            $rel = $_.FullName.Substring($Src.Length).TrimStart("\")
            $target = Join-Path $Dst $rel
            New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
            Copy-Item -LiteralPath $_.FullName -Destination $target -Force
        }
}

if ($StopFirst) {
    $recDst = Join-Path $backupRoot "ai-match-recordings"
    if (Test-Path (Join-Path $projectRoot "ai-match-recordings")) {
        Copy-Item -LiteralPath (Join-Path $projectRoot "ai-match-recordings") -Destination $recDst -Recurse -Force
        Write-Host "已备份: ai-match-recordings" -ForegroundColor Green
    }
    $logFull = Join-Path $backupRoot "crash-logs"
    New-Item -ItemType Directory -Path $logFull -Force | Out-Null
    Get-ChildItem (Join-Path $projectRoot "crash-logs") -File -ErrorAction SilentlyContinue |
        ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $logFull $_.Name) -Force }
    Write-Host "已备份: crash-logs（含 launcher.log）" -ForegroundColor Green
    Write-Host "服务器已停止，请手动运行 start-surviv.ps1 重新启动。" -ForegroundColor Yellow
} else {
    # ---- 不停服模式：复制已完成的 AI 录像（跳过正在录制的 .part） ----
    $recSrc = Join-Path $projectRoot "ai-match-recordings"
    if (Test-Path $recSrc) {
        $recDst = Join-Path $backupRoot "ai-match-recordings"
        Copy-TreeExcludingPart -Src $recSrc -Dst $recDst
        Write-Host "已备份: ai-match-recordings（跳过正在录制的 .part，下次备份自动补上）" -ForegroundColor Green
    }
    # ---- 不停服模式：复制崩溃日志（跳过启动器持续写入的 launcher.log） ----
    $logDst = Join-Path $backupRoot "crash-logs"
    New-Item -ItemType Directory -Path $logDst -Force | Out-Null
    Get-ChildItem (Join-Path $projectRoot "crash-logs") -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne "launcher.log" } |
        ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $logDst $_.Name) -Force }
    Write-Host "已备份: crash-logs（跳过运行中的 launcher.log）" -ForegroundColor Green
}

Write-Host ""
Write-Host "备份完成：$backupRoot" -ForegroundColor Cyan
