# V230 搜打撤补员：全局 worker 上限时优先补 AI 缺口最大的真人局

## 问题
- 「双搜打撤没有 AI 进入」：V226 引入的全局 bot worker 并发上限（默认 16）
  在 worker 被旧局占满时，会**静默跳过**搜打撤补员
  （`spawnReplacementExtractionBot` 开头 `botWorkerLimitReached()` 直接 return，
  无任何日志）→ 新建的双人/单人真人局一直补不到 AI。
- 端到端验证（dev 单进程 + 生产多进程）确认：**单独**跑搜打撤双人局时
  补员完全正常（真人加入 → `Extraction replenish: +2 AI` → AI 进入）；
  问题只在**并发**场景（worker 数达到上限）下复现。

## 实现（server/src/gameServer.ts）
- `tickExtractionReplenish` 重构为「先收集、后排序、再补员」：
  1. 收集所有需要补 AI 的搜打撤真人局，计算每个局的 AI 缺口
     （`target - serverBotCount`）；
  2. 按缺口**降序**排序——新创建、AI 仍为 0 的双人/单人局优先拿到
     worker 名额，而不是被 AI 快满的旧局长期占用；
  3. 全局 worker 上限满时，缺口大的局先补、缺口小的局暂缓（4 秒后重试）；
- 达到上限导致暂缓时，输出**限频告警日志**
  （`[bot-worker] 搜打撤补员：N 个真人局因全局 worker 上限暂缓（当前 X/上限），4 秒后自动重试`，
  30 秒最多一次），不再静默失败。

> 仍可后台调大「AI worker 全局并发上限」（人机自动补入 → maxBotWorkers），
> 机器内存充足时可适当提高，减少真人局等待补员。

## 验证
- mock 验证：duo（缺口 19）与 solo（缺口 1）同时需要补员且只剩 1 个 worker
  名额时，**duo 先补**（缺口大的真人局优先）；
- `test:v53-matchmaking-recovery`：新增源码断言（needy 排序 + 上限暂缓日志）；
- server `tsc` / build：PASS；`test:extraction`：PASS；
- 端到端：dev 单进程 + 生产多进程下搜打撤双人局均能补入 AI（真人加入 →
  `Extraction replenish: +2 AI` → 2 个 AI 以 `teamSize=2` 进入）。
