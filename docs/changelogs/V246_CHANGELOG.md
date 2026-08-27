# V246 搜打撤重连不限时：只要人没死就能重连

## 需求
- 搜打撤模式只要玩家人物**没彻底死**就能重连入局，**不限重连时间**。

## 实现

### 服务端
- `game/game.ts`：断线清理循环按模式区分——
  - **搜打撤**真人掉线**不设时间上限**（`Number.POSITIVE_INFINITY`）：
    只要人物未阵亡、对局未结束（10 分钟超时/撤离结束前），随时可重连，
    对局结束或撤离时自然清理；
  - 普通模式真人仍保持 3 分钟重连窗口（`reconnectTimeout`）；
  - bot 仍用 30 秒 `disconnectTimeout` 及时释放 worker；
- `game/gameManager.ts` / `game/gameProcessManager.ts`：`GameData` 新增
  `pendingHumanCount`（掉线未阵亡真人），生产多进程同步；
- `gameServer.ts`：搜打撤补员把 `pendingHumanCount` 计入等效真人——
  掉线真人仍占位，**不会**因为真人掉线而把 AI 补满，真人重连后不超员。

## 验证
- `reconnectSmokeTest` 新增：
  - 搜打撤真人掉线 **10 分钟**后仍保留在局、`pendingHumanCount` 仍计数、
    用同一 match token 重连成功（复用玩家对象）；
  - 普通模式真人掉线超 3 分钟被移除；
- extraction-replenish / room-lifecycle / extraction / game-process-reuse
  冒烟测试全部 PASS；server `tsc` PASS。
