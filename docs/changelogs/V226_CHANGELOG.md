# V226 全局限制并发 bot worker 数量（解决搜打撤补员风暴导致的 V8 Zone OOM）

## 需求
- 服务器崩溃主因：搜打撤（extraction）单人 AI 局持续补员，每批 AI 都 fork 一个
  独立的 node/ts-node 子进程（52 分钟内 fork 了 405 个 worker），加上每个 worker
  `--max-old-space-size=4096` 的堆上限，最终触发 V8 进程级 OOM：
  `Fatal process out of memory: Zone` / `JavaScript heap out of memory`，
  worker 崩溃 → AI 掉线 → 再补员 → 恶性循环。
- 增加**全局并发 worker 上限**：达到上限时暂停启动新 worker，等已有 worker 退出
  后再补，切断恶性循环。

## 实现

### server/src/config.ts
- `BotAutoFillConfig` 新增 `maxBotWorkers`（全局并发 bot worker 子进程上限），
  默认 **16**，加载时归一化到 1–64。

### server/src/gameServer.ts
- 新增 `activeBotWorkerCount()`：统计跨所有房间当前活跃的 bot worker 子进程数；
- 新增 `botWorkerLimitReached()`：活跃数 ≥ 上限时返回 true；
- `spawnGameBot`（所有 bot worker 的唯一 fork 入口）改为返回 boolean，
  启动前先检查全局上限，达到上限时拒绝启动并打一条 WARNING；
- `spawnReplacementExtractionBot`（搜打撤补员）：**补员前先检查上限**，
  达到上限时不创建 join token、直接跳过本轮（tickExtractionReplenish 每 4 秒
  重试）；spawn 失败时打「worker 并发已达上限，跳过（稍后重试）」日志，
  不再误报「+N AI」。

### 后台配置（server/src/adminServer.ts + client/public/admin）
- `setBotAutoFillConfig` 新增第 9 个参数 `maxBotWorkers`（校验 1–64），
  快照 `toBotAutoFillSnapshot()` 返回该字段；
- 后台「人机自动补入」顶部新增 **「AI worker 全局并发上限」** 输入框
  （1–64 个进程，带说明 tooltip），随 AI 补入配置一起保存。

## 验证
- server `tsc`：PASS；
- `test:admin`：`setBotAutoFillConfig(..., maxBotWorkers=12)` 生效并返回 12；
- `test:bot-autofill-config`：默认上限为 16（有界正整数）；
- `test:v50-room-targets`、`test:player-accounts`：PASS；
- client `vite build` 通过，`dist/admin` 已更新。

> 说明：上限是「并发进程数」，与每 worker 承载的 AI 数（extractionReplenishBatch）
> 相互独立；调低上限可进一步省内存，调高可让更多 AI 并行（需机器内存充足）。
