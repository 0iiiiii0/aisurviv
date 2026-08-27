# V245 搜打撤性能优化：AI 死亡即释放进程 + 精确补员

## 需求
- 搜打撤模式 ping 值过高且卡顿（与其他模式区别明显）；
- 优化 AI 补充；
- 确认 AI 死亡后会释放进程。

## 问题根因
- 搜打撤**没有 GameOver 淘汰**消息，而 smartBot 只在收到 GameOver 时才
  `terminate`（`Kill` 消息此前被忽略）。因此搜打撤里的 bot 被击杀后，
  worker 进程**永远不会退出**；而补员每 4 秒又启动新 worker，导致
  **进程持续堆积**，CPU/内存被占满 → 卡顿、ping 升高；
- 补员批次 `batch` 与实际缺口 `deficit` 无关：缺 1 个 AI 时也可能一次
  补满一整批（1~8 个），造成 AI 超标、多余 worker；
- bot 阵亡后 `serverBotCount` 仍计入（等待断开），补员缺口计算不准确。

## 实现

### smartBot.ts
- `think()` 检测到自身**彻底死亡**（`me.data.dead`，倒地不算）时立即
  `terminate("died")`：关闭 ws → 服务端标记 disconnected → worker 内所有
  bot 死亡后进程自动退出（`runBotTick` 已支持），**释放 worker 名额**；
  aim-training 靶子除外。

### gameServer.ts
- 补员按**实际缺口**精确计算：`batch = clamp(deficit, batchCap)`，
  不再一次补过头（`clampExtractionReplenishBatch` 导出）；
- 普通搜打撤补员 AI 使用更慢的决策间隔（`Config.botAutoFill
  .extractionThinkIntervalMs`，默认 150ms）——搜打撤 AI 以搜索/跑毒/战斗
  为主，放宽频率显著降低多 AI 长时间对局的 CPU，缓解高 ping/卡顿；
  绝密模式强 AI 保持各自难度默认频率。

### config.ts
- `BotAutoFillConfig` 新增 `extractionThinkIntervalMs`（默认 150，范围
  1~250），后台可调。

## 验证
- 新增 `server/src/extractionReplenishSmokeTest.ts`（`test:extraction-replenish`）：
  批次精确钳制、bot 阵亡+断开后 `serverBotCount` 立即下降、补员缺口重新计算；
- smartBot / extraction / extraction-secret / reconnect / revive /
  bot-auto-fill-config 冒烟测试全部 PASS；
- server `tsc` PASS。
