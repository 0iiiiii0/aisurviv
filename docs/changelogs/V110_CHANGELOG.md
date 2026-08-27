# V110 修复：高负载下 "Fatal process out of memory: Zone"

## 问题

- 旧版本服务器在高负载（50v50 / 大量 bot / 多房间）时，V8 堆达到默认上限
  （本机约 4GB）后报 `Fatal process out of memory: Zone` 崩溃退出，
  客户端表现为频繁 "Host closed the connection."，启动器反复 AUTO-RESTART。

## 修复（内存上限分层设置）

1. **启动器（start-surviv.ps1）**：Start-SurvivServerJob 在启动前设置
   `$env:NODE_OPTIONS = "--max-old-space-size=8192 --max-semi-space-size=64"`
   —— 游戏服务器 V8 堆上限提到 8GB，并通过 NODE_OPTIONS 传递给所有子进程。
2. **npm 脚本（server/package.json）**：`dev` / `dev:api` / `dev:game`
   直接带上 `--max-old-space-size=8192 --max-semi-space-size=64`，
   `start:api` / `start:game` / `start:dev` 带上 `--max-old-space-size=8192`，
   无论手动启动还是启动器启动都生效。
3. **bot worker（gameServer.ts spawnGameBot）**：每个 smart-bot worker
   显式设置 `NODE_OPTIONS="… --max-old-space-size=4096 --max-semi-space-size=32"`
   （覆盖父进程值）——单 worker 内存受限，防止某个 worker 的 Zone OOM
   拖垮整场对局。
4. 保留 devServer.ts 的崩溃日志捕获（uncaughtException / unhandledRejection
   → docs/logs/server-crash.log），后续异常可离线定位。

## 说明

- 启动器 --watch 行为保持原样（未改动）。
- 若机器物理内存小于 16GB，可把 8192 调低为 6144（改两处：start-surviv.ps1
  与 server/package.json 的 dev 脚本）。
- 当前 8001 实例若是在改动前手动启动的，重启一次（start-surviv.cmd）即可生效。