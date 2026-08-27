# V154 搜打撤对局剩余时间倒计时（玩家可见）

## 需求

确认并实现玩家在对局中能看到 10 分钟时限的剩余时间倒计时。

## 现状确认

- 此前服务端 `startedTime` 只通过 `updateData` 发给后台进程，
  **玩家客户端收不到任何对局时间**，因此玩家看不到倒计时。

## 实现

### 协议（shared/net/matchTimeMsg.ts + net.ts）
- 新增 `MatchTimeMsg`：`started`（布尔）+ `startedTime`（秒，float32），
  消息体按字节对齐；
- `MsgType` 枚举追加 `MatchTime` 并导出。

### 共享常量（shared/defs/extractionDefs.ts）
- 新增 `EXTRACTION_MATCH_TIME_LIMIT_SECONDS = 600`，
  服务端时限判定与客户端倒计时统一使用，避免魔数漂移。

### 服务端（server/src/game/game.ts）
- 对局开始后、搜打撤模式下，每约 1 秒向所有玩家广播一次
  `MatchTimeMsg`（当前 `startedTime`），带宽约 5 字节/秒/玩家；
- `extractionSystem` 的 10 分钟判定改用共享常量。

### 客户端（client/src/game.ts + index.html + css/game.css）
- `onMsg` 接收 `MatchTimeMsg` 存入 `matchStartedTime`；
- `updateExtraction` 每帧更新小地图上方的倒计时条：
  - 显示 `MM:SS`（剩余 = 600 − 服务端已过秒数，最小 0）；
  - 非搜打撤模式 / 未开局 / 观战状态下隐藏；
  - 剩余 ≤ 60 秒时数字变红（`.urgent`）。
- 新增 `#ui-match-timer` 元素（位于地图信息条上方，深色底白字）。

## 验证

- server tsc / client tsc + vite build：PASS
- `test:extraction` 新增断言：
  - MatchTimeMsg 序列化往返（started / startedTime 精确还原）；
  - 对局开始后 ~1 秒内服务端广播流中出现 MatchTime 消息；PASS
- `test:admin` / `test:all-modes`：PASS
