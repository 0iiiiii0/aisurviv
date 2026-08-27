param(
    [switch]$NoBrowser,
    [switch]$ExitAfterReady
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$clientPort = 8001
$apiPort = 8000
$gamePort = 3000
$gameJob = $null
$apiJob = $null
$clientJob = $null
$exitCode = 0

function Test-Port {
    param([Parameter(Mandatory = $true)][int]$Port)

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $connection = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        if (-not $connection.AsyncWaitHandle.WaitOne(200)) {
            return $false
        }
        $client.EndConnect($connection)
        return $client.Connected
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Test-DistFresh {
    param(
        [Parameter(Mandatory = $true)][string]$DistFile,
        [Parameter(Mandatory = $true)][string[]]$SourceDirs
    )
    if (-not (Test-Path -LiteralPath $DistFile)) {
        return $false
    }
    $distTime = (Get-Item -LiteralPath $DistFile).LastWriteTime
    foreach ($dir in $SourceDirs) {
        if (-not (Test-Path -LiteralPath $dir)) {
            continue
        }
        $newest = Get-NewestSourceFile -Dir $dir
        if ($newest -and $newest.LastWriteTime -gt $distTime) {
            return $false
        }
    }
    return $true
}

function Get-NewestSourceFile {
    param([Parameter(Mandatory = $true)][string]$Dir)
    # 递归时直接剪掉 node_modules / dist / .git，避免遍历海量依赖导致启动卡住。
    $newest = $null
    foreach ($item in @(Get-ChildItem -LiteralPath $Dir -Force -ErrorAction SilentlyContinue)) {
        if ($item.PSIsContainer) {
            if ($item.Name -in @("node_modules", "dist", ".git")) {
                continue
            }
            $sub = Get-NewestSourceFile -Dir $item.FullName
            if ($sub -and ($null -eq $newest -or $sub.LastWriteTime -gt $newest.LastWriteTime)) {
                $newest = $sub
            }
        }
        elseif (
            $item.Name -ne "news.json" -and
            ($null -eq $newest -or $item.LastWriteTime -gt $newest.LastWriteTime)
        ) {
            $newest = $item
        }
    }
    return $newest
}

function Test-ApiHealth {
    param([Parameter(Mandatory = $true)][int]$Port)
    # HTTP 探测：端口能连但 API 无响应 = 服务器事件循环挂起（hang），
    # 这种"假活"状态 TCP 检测不出来，必须靠 HTTP 响应判断。
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/site_info" `
            -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        return $resp.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

function Test-GameHealth {
    param([Parameter(Mandatory = $true)][int]$Port)
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" `
            -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        return $resp.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

function Test-ClientHealth {
    param([Parameter(Mandatory = $true)][int]$Port)
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/admin/" `
            -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        return $resp.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

function Install-DependenciesIfMissing {
    param([Parameter(Mandatory = $true)][string]$Directory)

    if (Test-Path -LiteralPath (Join-Path $Directory "node_modules\.pnpm")) {
        return
    }

    Write-Host "Installing workspace dependencies with the frozen pnpm lockfile. This may take a few minutes..." -ForegroundColor Yellow
    Push-Location $Directory
    try {
        & pnpm.cmd install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) {
            throw "Workspace dependency installation failed."
        }
    }
    finally {
        Pop-Location
    }
}

function Show-JobOutput {
    param($Job, [string]$Prefix)

    if ($null -eq $Job) {
        return
    }
    Receive-Job -Job $Job -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host "[$Prefix] $_"
    }
}

function Show-JobOutputLive {
    param($Job, [string]$Prefix, [string]$LogFile = "")

    if ($null -eq $Job) {
        return
    }
    while ($Job.HasMoreData) {
        $lines = @(Receive-Job -Job $Job -ErrorAction SilentlyContinue)
        if ($lines.Count -eq 0) {
            break
        }
        foreach ($line in $lines) {
            $text = "[{0}] {1}" -f $Prefix, $line
            Write-Host $text
            if ($LogFile) {
                Add-Content -LiteralPath $LogFile -Value $text
            }
        }
    }
}

function Get-PortOwnerPids {
    param([Parameter(Mandatory = $true)][int]$Port)

    $pids = @()
    try {
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $lines = & netstat.exe -ano -p tcp 2>&1
        $ErrorActionPreference = $prevEap
        foreach ($line in $lines) {
            $parts = @($line.Trim() -split "\s+")
            # Only terminate the process that owns the listening socket. A
            # broad ':port' match can also hit an unrelated outbound client
            # whose remote endpoint happens to use the same port.
            if (
                $parts.Count -ge 5 -and
                $parts[0] -eq "TCP" -and
                $parts[1] -match ":$Port$" -and
                $parts[3] -eq "LISTENING"
            ) {
                $owner = [int]$parts[4]
                if ($owner -gt 0 -and $pids -notcontains $owner) {
                    $pids += $owner
                }
            }
        }
    }
    catch {
        # netstat unavailable or access denied; the caller falls back to probing.
    }
    return $pids
}

function Stop-ProcessTree {
    param([int]$ProcessId)

    if ($ProcessId -le 0) {
        return
    }
    $all = @()
    try {
        $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    }
    catch {
        $all = @()
    }
    $byParent = @{}
    foreach ($p in $all) {
        $parent = 0
        if ($p.ParentProcessId) {
            $parent = [int]$p.ParentProcessId
        }
        if (-not $byParent.ContainsKey($parent)) {
            $byParent[$parent] = @()
        }
        $byParent[$parent] += [int]$p.ProcessId
    }
    $stack = New-Object System.Collections.Generic.Stack[int]
    $stack.Push($ProcessId)
    $order = New-Object System.Collections.Generic.List[int]
    while ($stack.Count -gt 0) {
        $current = $stack.Pop()
        if ($byParent.ContainsKey($current)) {
            foreach ($child in $byParent[$current]) {
                $order.Add($child)
                $stack.Push($child)
            }
        }
    }
    # Stop descendants first, then the root process.
    for ($i = $order.Count - 1; $i -ge 0; $i--) {
        Stop-Process -Id $order[$i] -Force -ErrorAction SilentlyContinue
    }
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Invoke-KillProcessTree {
    param([int]$ProcessId)

    if ($ProcessId -le 0) {
        return
    }
    # taskkill writes its "Access denied" style messages to stderr; under
    # $ErrorActionPreference = 'Stop' (PS 5.1) that would raise an exception
    # before we can read $LASTEXITCODE, so run it with a temporary override.
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & taskkill.exe /PID $ProcessId /T /F 2>&1 | Out-Null
    $killExitCode = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    if ($killExitCode -ne 0) {
        # Fallback when taskkill is unavailable or denied: stop the whole tree
        # (CIM-based, best effort) so the launcher can still release its ports.
        Stop-ProcessTree -ProcessId $ProcessId
    }
}

function Stop-PortOwner {
    param([Parameter(Mandatory = $true)][int]$Port, [string]$Label)

    $pids = Get-PortOwnerPids -Port $Port
    if ($pids.Count -eq 0) {
        return
    }
    foreach ($owner in $pids) {
        if ($owner -eq $PID) {
            continue
        }
        Write-Host "Port $Port is occupied by PID $owner ($Label). Stopping its process tree..." -ForegroundColor Yellow
        Invoke-KillProcessTree -ProcessId $owner
    }
    # Give the OS a moment to release the sockets.
    Start-Sleep -Milliseconds 800
}

function Wait-PortFree {
    param([Parameter(Mandatory = $true)][int]$Port)

    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if (-not (Test-Port -Port $Port)) {
            return $true
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Add-OwnedProcess {
    param($Job, [string]$PidFile)

    $jobPid = $null
    try {
        $jobPid = $Job.ChildJobs[0].ProcessId
    }
    catch {
        $jobPid = $null
    }
    if ($jobPid) {
        Add-Content -LiteralPath $PidFile -Value $jobPid -Encoding ascii
    }
}

function Stop-OwnedProcessTree {
    param([string]$PidFile)

    if (-not $PidFile -or -not (Test-Path -LiteralPath $PidFile)) {
        return
    }
    $pids = Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue
    foreach ($id in $pids) {
        $parsedId = 0
        if ([int]::TryParse([string]$id, [ref]$parsedId)) {
            Invoke-KillProcessTree -ProcessId $parsedId
        }
    }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

function Stop-OwnedJob {
    param($Job)

    if ($null -eq $Job) {
        return
    }
    # Kill the whole process tree (powershell job -> cmd -> pnpm -> node) so the
    # Node services never survive the launcher and keep holding runtime ports.
    $jobProcessId = $null
    try {
        $jobProcessId = $Job.ChildJobs[0].ProcessId
    }
    catch {
        $jobProcessId = $null
    }
    if ($jobProcessId) {
        Invoke-KillProcessTree -ProcessId $jobProcessId
    }
    Stop-Job -Job $Job -ErrorAction SilentlyContinue
    Remove-Job -Job $Job -Force -ErrorAction SilentlyContinue
}

function Start-SurvivNodeJob {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Script,
        [Parameter(Mandatory = $true)][string]$Directory
    )

    $job = Start-Job -Name $Name -ArgumentList $Directory, $Script -ScriptBlock {
        param($WorkingDirectory, $PackageScript)
        Set-Location -LiteralPath $WorkingDirectory
        $reportDir = Join-Path $WorkingDirectory "..\crash-logs"
        New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
        # The game process passes NODE_OPTIONS to room and smart-bot children.
        # The API process harmlessly shares the same diagnostics policy.
        $env:NODE_OPTIONS = "--max-old-space-size=8192 --max-semi-space-size=64 --report-on-fatalerror --report-directory=$reportDir"
        $env:NODE_ENV = "production"
        & pnpm.cmd run $PackageScript
        if ($LASTEXITCODE -ne 0) {
            throw "$PackageScript exited with code $LASTEXITCODE"
        }
    }
    Add-OwnedProcess -Job $job -PidFile $launcherPidFile
    return $job
}

function Start-SurvivGameJob {
    return Start-SurvivNodeJob -Name "SurvivGame" -Script "start:game" -Directory $serverDirectory
}

function Start-SurvivApiJob {
    return Start-SurvivNodeJob -Name "SurvivApi" -Script "start:api" -Directory $serverDirectory
}

function Start-SurvivClientJob {
    $job = Start-Job -Name "SurvivClient" -ArgumentList $clientDirectory, $clientPort -ScriptBlock {
        param($Directory, $Port)
        Set-Location -LiteralPath $Directory
        $env:NODE_ENV = "production"
        & pnpm.cmd run preview -- --host 0.0.0.0 --port $Port --strictPort
        if ($LASTEXITCODE -ne 0) {
            throw "Client preview exited with code $LASTEXITCODE"
        }
    }
    Add-OwnedProcess -Job $job -PidFile $launcherPidFile
    return $job
}

function Test-UserQuit {
    try {
        if (-not [Console]::KeyAvailable) {
            return $false
        }
        $key = [Console]::ReadKey($true)
        return ($key.Key -eq [ConsoleKey]::Enter) -or ($key.KeyChar -in @('q', 'Q'))
    }
    catch {
        # 无交互控制台（例如通过其它进程启动）时忽略按键检测，Ctrl+C 仍可退出。
        return $false
    }
}

# Track the job process ids in a temp file so the PowerShell.Exiting fallback
# can kill the whole node process tree even when the window is closed with the
# X button (which bypasses the finally block).
$launcherPidFile = Join-Path $env:TEMP ("surviv-launcher-pids-{0}.txt" -f $PID)
Register-EngineEvent -SourceIdentifier "SurvivLauncher.Exiting" -Action {
    $pidFile = $using:launcherPidFile
    if (Test-Path -LiteralPath $pidFile) {
        $ids = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue
        foreach ($id in $ids) {
            $parsedId = 0
            if ([int]::TryParse([string]$id, [ref]$parsedId)) {
                $prevEap = $ErrorActionPreference
                $ErrorActionPreference = 'Continue'
                & taskkill.exe /PID $parsedId /T /F 2>&1 | Out-Null
                $killExitCode = $LASTEXITCODE
                $ErrorActionPreference = $prevEap
                if ($killExitCode -ne 0) {
                    $procs = @()
                    try {
                        $procs = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
                    }
                    catch {
                        $procs = @()
                    }
                    $byParent = @{}
                    foreach ($p in $procs) {
                        $parent = 0
                        if ($p.ParentProcessId) {
                            $parent = [int]$p.ParentProcessId
                        }
                        if (-not $byParent.ContainsKey($parent)) {
                            $byParent[$parent] = @()
                        }
                        $byParent[$parent] += [int]$p.ProcessId
                    }
                    $stack = New-Object System.Collections.Generic.Stack[int]
                    $stack.Push($parsedId)
                    $order = New-Object System.Collections.Generic.List[int]
                    while ($stack.Count -gt 0) {
                        $current = $stack.Pop()
                        if ($byParent.ContainsKey($current)) {
                            foreach ($child in $byParent[$current]) {
                                $order.Add($child)
                                $stack.Push($child)
                            }
                        }
                    }
                    for ($i = $order.Count - 1; $i -ge 0; $i--) {
                        Stop-Process -Id $order[$i] -Force -ErrorAction SilentlyContinue
                    }
                    Stop-Process -Id $parsedId -Force -ErrorAction SilentlyContinue
                }
            }
        }
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    }
} | Out-Null

try {
    $Host.UI.RawUI.WindowTitle = "Surviv.io Web Admin Launcher"
    Write-Host ""
    Write-Host "  SURVIV.IO WEB ADMIN LAUNCHER" -ForegroundColor Green
    Write-Host "  ----------------------------" -ForegroundColor DarkGray

    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
        throw "Node.js was not found. Install Node.js 22.18.0 or newer first."
    }
    if (-not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) {
        throw "pnpm.cmd was not found. Enable Corepack (corepack enable pnpm) or install pnpm 11.18.0."
    }

    $nodeVersionText = (& node.exe -p "process.versions.node").Trim()
    $nodeVersion = [version]$nodeVersionText
    if ($nodeVersion -lt [version]"22.18.0") {
        throw "Node.js 22.18.0 or newer is required (found $nodeVersionText)."
    }

    # Allow pnpm to repair a workspace moved from another absolute path without
    # waiting for an interactive modules-purge confirmation.
    $env:CI = "true"

    $serverDirectory = Join-Path $projectRoot "server"
    $clientDirectory = Join-Path $projectRoot "client"
    # 实时日志同时落盘到专门存放崩溃日志的 crash-logs/ 目录：
    # 服务器/客户端崩溃（含 V8 fatal 等进程级错误）的输出会被保存，
    # 便于事后定位崩溃原因。
    $launcherLogFile = Join-Path $projectRoot "crash-logs\launcher.log"
    New-Item -ItemType Directory -Force -Path (Split-Path $launcherLogFile) | Out-Null
    Install-DependenciesIfMissing -Directory $projectRoot

    # The browser reaches Vite on 8001 and the game/ping endpoint on 3000.
    # The account API remains loopback-only on 8000 and is proxied by Vite.
    foreach ($service in @(
            @{ Port = $clientPort; Label = "client preview" },
            @{ Port = $apiPort; Label = "API server" },
            @{ Port = $gamePort; Label = "game server" }
        )) {
        if (Test-Port -Port $service.Port) {
            Stop-PortOwner -Port $service.Port -Label $service.Label
            if (-not (Wait-PortFree -Port $service.Port)) {
                throw "Port $($service.Port) is still occupied after cleanup. Close the old Surviv/Node process before starting."
            }
        }
    }

    # 清理上次运行残留的仓库/账号锁与临时文件：残留锁会让数据操作进入
    # 同步忙等，阻塞事件循环导致"端口能连但连不上对局"。
    # 运行数据位于 SURVIV_DATA_DIR 或 项目根\server-data（不是项目根目录）。
    $envDataDir = $env:SURVIV_DATA_DIR
    if ($envDataDir -and $envDataDir.Trim()) {
        if (-not [System.IO.Path]::IsPathRooted($envDataDir.Trim())) {
            $envDataDir = Join-Path $projectRoot $envDataDir.Trim()
        }
        $lockDataDir = $envDataDir
    } else {
        $lockDataDir = Join-Path $projectRoot "server-data"
    }
    foreach ($dir in @($lockDataDir, $projectRoot)) {
        if (-not (Test-Path -LiteralPath $dir)) { continue }
        Get-ChildItem -LiteralPath $dir -Filter "survivio-*.json.lock" `
            -Force -ErrorAction SilentlyContinue | Remove-Item -Force -Recurse -ErrorAction SilentlyContinue
        Get-ChildItem -LiteralPath $dir -Filter "survivio-*.json.*.tmp" `
            -Force -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
        Get-ChildItem -LiteralPath $dir -Filter "survivio-*.json.tmp" `
            -Force -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    }

    # Rolldown is fast and owns four coordinated entries (API, game server,
    # room process and smart bot). Rebuild them together so no stale worker is
    # paired with a newer parent process.
    Write-Host "Building server workspace (Rolldown -> server/dist) ..."
    Push-Location $projectRoot
    try {
        & pnpm.cmd --filter '@survev/server' build
        if ($LASTEXITCODE -ne 0) {
            throw "Server build failed with code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }

    # The client is a separate static/preview process in 0.3. Vite preview
    # supplies the same API/game proxies as development without recompiling on
    # every request.
    $clientDistIndex = Join-Path $clientDirectory "dist\index.html"
    if (-not (Test-DistFresh -DistFile $clientDistIndex -SourceDirs @(
            $clientDirectory,
            (Join-Path $projectRoot "shared"),
            (Join-Path $projectRoot "config.ts"),
            (Join-Path $projectRoot "configType.ts")
        ))) {
        Write-Host "Building client (vite build -> client/dist) ..."
        Push-Location $projectRoot
        try {
            & pnpm.cmd --filter '@survev/client' build
            if ($LASTEXITCODE -ne 0) {
                throw "Client build failed with code $LASTEXITCODE"
            }
        }
        finally {
            Pop-Location
        }
    }

    Write-Host "[1/3] Starting the game server (server/dist/gameServer.js)..."
    $gameJob = Start-SurvivGameJob
    Write-Host "[2/3] Starting the API/team-menu server (server/dist/index.js)..."
    $apiJob = Start-SurvivApiJob
    Write-Host "[3/3] Starting the client preview proxy (client/dist on port $clientPort)..."
    $clientJob = Start-SurvivClientJob

    Write-Host "Waiting for the client, API and game server..."
    $stackReady = $false
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        Show-JobOutputLive -Job $gameJob -Prefix "game" -LogFile $launcherLogFile
        Show-JobOutputLive -Job $apiJob -Prefix "api" -LogFile $launcherLogFile
        Show-JobOutputLive -Job $clientJob -Prefix "client" -LogFile $launcherLogFile

        $deadJobs = @($gameJob, $apiJob, $clientJob) | Where-Object {
            $_ -and $_.State -in @("Completed", "Failed", "Stopped")
        }
        if ($deadJobs.Count -gt 0) {
            throw "A runtime process stopped before the stack became ready."
        }

        $stackReady = (Test-GameHealth -Port $gamePort) -and
            (Test-ApiHealth -Port $apiPort) -and
            (Test-ClientHealth -Port $clientPort)
        if ($stackReady) {
            break
        }
        Start-Sleep -Milliseconds 500
    }

    if (-not $stackReady) {
        throw "Startup timed out. Expected client/API/game ports $clientPort/$apiPort/$gamePort."
    }

    Write-Host ""
    Write-Host "[OK] Web admin is ready." -ForegroundColor Green
    Write-Host "     http://localhost:$clientPort/admin/"
    Write-Host ""
    Write-Host "日志实时滚动；服务器崩溃会自动重启。" -ForegroundColor Cyan
    Write-Host "按 Enter 或 q 停止所有服务；关闭窗口或 Ctrl+C 同样会清理服务。" -ForegroundColor Cyan
    if (-not $NoBrowser) {
        Start-Process "http://localhost:$clientPort/admin/"
    }

    if ($ExitAfterReady) {
        $apiCheck = Invoke-WebRequest -Uri "http://127.0.0.1:$clientPort/api/site_info" -UseBasicParsing -TimeoutSec 5
        $gameCheck = Invoke-WebRequest -Uri "http://127.0.0.1:$gamePort/health" -UseBasicParsing -TimeoutSec 5
        $announcementCheck = Invoke-WebRequest -Uri "http://127.0.0.1:$clientPort/api/live-announcement" -UseBasicParsing -TimeoutSec 5
        $spectateCheck = Invoke-WebRequest -Uri "http://127.0.0.1:$clientPort/api/spectate/rooms" -UseBasicParsing -TimeoutSec 5
        $webCheck = Invoke-WebRequest -Uri "http://127.0.0.1:$clientPort/admin/" -UseBasicParsing -TimeoutSec 5
        if (
            $apiCheck.StatusCode -ne 200 -or
            $gameCheck.StatusCode -ne 200 -or
            $announcementCheck.StatusCode -ne 200 -or
            $spectateCheck.StatusCode -ne 200 -or
            $webCheck.StatusCode -ne 200
        ) {
            throw "Launcher self-test received an unexpected HTTP status."
        }
        Write-Host "[OK] Launcher self-test passed." -ForegroundColor Green
    }
    else {
        # Treat the three processes as one deployment unit. A dead API or
        # preview proxy is just as user-visible as a dead game listener, so a
        # failed health streak restarts the complete, version-matched stack.
        $stackDownStreak = 0
        $keepRunning = $true
        while ($keepRunning) {
            Show-JobOutputLive -Job $gameJob -Prefix "game" -LogFile $launcherLogFile
            Show-JobOutputLive -Job $apiJob -Prefix "api" -LogFile $launcherLogFile
            Show-JobOutputLive -Job $clientJob -Prefix "client" -LogFile $launcherLogFile

            $stackUp = (Test-GameHealth -Port $gamePort) -and
                (Test-ApiHealth -Port $apiPort) -and
                (Test-ClientHealth -Port $clientPort)
            $deadJobs = @($gameJob, $apiJob, $clientJob) | Where-Object {
                $_ -and $_.State -in @("Completed", "Failed", "Stopped")
            }
            if ($stackUp) {
                $stackDownStreak = 0
            }
            else {
                $stackDownStreak++
                if ($deadJobs.Count -gt 0 -or $stackDownStreak -ge 6) {
                    Write-Host ""
                    Write-Host "[AUTO-RESTART] 客户端/API/游戏服务健康检查失败，正在重启完整服务栈..." -ForegroundColor Yellow
                    Stop-OwnedJob -Job $clientJob
                    Stop-OwnedJob -Job $apiJob
                    Stop-OwnedJob -Job $gameJob
                    foreach ($service in @(
                            @{ Port = $clientPort; Label = "stale client preview" },
                            @{ Port = $apiPort; Label = "stale API server" },
                            @{ Port = $gamePort; Label = "stale game server" }
                        )) {
                        Stop-PortOwner -Port $service.Port -Label $service.Label
                        Wait-PortFree -Port $service.Port | Out-Null
                    }
                    $gameJob = Start-SurvivGameJob
                    $apiJob = Start-SurvivApiJob
                    $clientJob = Start-SurvivClientJob
                    $stackDownStreak = 0
                    $stackRecovered = $false
                    for ($attempt = 0; $attempt -lt 120; $attempt++) {
                        Show-JobOutputLive -Job $gameJob -Prefix "game" -LogFile $launcherLogFile
                        Show-JobOutputLive -Job $apiJob -Prefix "api" -LogFile $launcherLogFile
                        Show-JobOutputLive -Job $clientJob -Prefix "client" -LogFile $launcherLogFile
                        if (Test-UserQuit) {
                            $keepRunning = $false
                            break
                        }
                        if (
                            (Test-GameHealth -Port $gamePort) -and
                            (Test-ApiHealth -Port $apiPort) -and
                            (Test-ClientHealth -Port $clientPort)
                        ) {
                            $stackRecovered = $true
                            break
                        }
                        Start-Sleep -Milliseconds 500
                    }
                    if ($stackRecovered) {
                        Write-Host "[AUTO-RESTART] 完整服务栈已恢复。" -ForegroundColor Green
                    }
                    else {
                        Write-Host "[AUTO-RESTART] 服务栈重启后仍未就绪，继续监视（将自动重试）..." -ForegroundColor Red
                    }
                }
            }

            if (Test-UserQuit) {
                $keepRunning = $false
                break
            }
            Start-Sleep -Milliseconds 400
        }
        Write-Host ""
        Write-Host "正在停止所有服务..." -ForegroundColor Cyan
    }
}
catch {
    $exitCode = 1
    Write-Host ""
    Write-Host "STARTUP ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Check the messages above for details." -ForegroundColor Yellow
}
finally {
    Stop-OwnedJob -Job $clientJob
    Stop-OwnedJob -Job $apiJob
    Stop-OwnedJob -Job $gameJob
    Stop-OwnedProcessTree -PidFile $launcherPidFile
    # Start-Job descendants can be reparented while their shell is stopping.
    # Release the exact ports owned by this launcher as a final, deterministic
    # cleanup so -ExitAfterReady and Ctrl+C never leave an orphaned service.
    foreach ($service in @(
            @{ Port = $clientPort; Label = "client preview cleanup" },
            @{ Port = $apiPort; Label = "API server cleanup" },
            @{ Port = $gamePort; Label = "game server cleanup" }
        )) {
        Stop-PortOwner -Port $service.Port -Label $service.Label
        Wait-PortFree -Port $service.Port | Out-Null
    }
}

if ($exitCode -ne 0 -and -not $ExitAfterReady) {
    Write-Host ""
    $null = Read-Host "Press Enter to close"
}
if ($ExitAfterReady) {
    exit $exitCode
}
