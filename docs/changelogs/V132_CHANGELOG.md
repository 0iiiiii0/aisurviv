# V132 修复：对局 10 秒内 "Host closed the connection"（dev 服务被录像写入触发无限重启）

## 现象
- 对局经常在开局 10 秒内断开，提示 **Host closed the connection**；
- 几乎每场必现，正常对局无法进行。

## 根因（已定位并实验证实）
1. 开发服务器以 `node --watch`（ts-node watch）运行：
   `node -r ts-node/register --watch --watch-path=../shared --watch-path=./src src/devServer.ts`
2. 实测（同参数临时 watcher 对照实验）：
   - 写入 `server/` 下任意文件（含 `server/ai-match-recordings/`）**都会触发
     "Restarting"**——该 watch 实际监视整个 `server/` 目录树，而非仅 `./src`；
   - 写入项目根目录、workspace 根目录**不触发**重启。
3. AI 对局录像（`server/src/bot/aiMatchRecorder.ts`，V56 引入）在每场带 AI 的
   对局中每 **750ms** 写一次 `frames-001.jsonl.part` / `events-001.jsonl.part`
   到 `server/ai-match-recordings/`（默认路径为 `cwd/ai-match-recordings`，
   cwd=server）。
4. 于是：进对局 → 录像开始写入 → watch 重启整个 dev server → 所有 WebSocket
   断开 → 客户端提示 "Host closed the connection"；重启后新对局再次触发，
   形成死循环（服务端日志出现大量 `Restarting 'src/devServer.ts'`，
   11:11–11:14 期间 9 次实例重启、27 行 Restarting）。

## 修复
1. `server/src/bot/aiMatchRecorder.ts`
   - 默认录像根目录从 `cwd/ai-match-recordings`（= server/ 内）改为
     `cwd/../ai-match-recordings`（= 项目根目录，位于 watch 树之外）；
   - 仍支持 `BOT_RECORD_DIR` 环境变量覆盖。
2. `server/src/game/gameProcessManager.ts`
   - `game-process-crashes` 默认目录同样移到 `cwd/../game-process-crashes`，
     避免进程事件日志触发 watch 重启。
3. `server/src/aiCapabilityTest.ts`
   - 测试录像路径同步改为项目根目录。
4. 存量数据迁移：`server/ai-match-recordings`（约 219 MB，66 项）整体移动到
   项目根目录 `ai-match-recordings/`，历史录像不丢失。

## 端到端验证（headless Edge + CDP 真实进对局）
- 进 Normal 单人局：`POST /api/find_game` 成功、`ws://localhost:8001/play?...`
  连接建立、游戏资源加载、AI（normal/hard/pro）正常加入并活动；
- 录像确认写入新路径：
  `D:\codex项目\surviv.io\surviv.io-main-v53-matchmaking-recovery\ai-match-recordings\...`；
- 对局持续 40+ 秒期间服务端日志 **0 次 Restarting / 0 次 Failed running**，
  连接未断开；
- 服务端 tsc：PASS；client build：PASS。

## 环境清理
- 移除了 10:16 启动的隐藏 dev 实例残留（watcher 父子进程链、vite），
  避免新旧实例抢占 8001 互相踢；
- 当前 dev 环境为单实例（server 8001 + vite 3000），日志：
  `%TEMP%\surviv-dev-logs\{server,client}.log`。

## 备注
- 该问题只影响 dev 模式（`node --watch`）。生产模式（node dist 直接运行）
  本就不会因文件写入重启，但录像/进程日志路径也已一并修正，行为一致。