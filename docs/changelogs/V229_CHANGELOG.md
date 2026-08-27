# V229 匹配不再把玩家送进剩余时间小于 5 分钟的对局

## 需求
- 玩家匹配时不应进入已经快结束的对局（剩余时间 < 5 分钟）。
- 主要痛点：搜打撤限时 10 分钟且**没有毒圈**（canJoin 的 `gas.stage < 2`
  条件恒真），玩家会被送进只剩 1–2 分钟的局；普通 BR 原本就被
  `gas.stage < 2` 限制在开局早期，不受影响但统一兜底。

## 实现

### shared/defs/extractionDefs.ts
- 新增 `MIN_JOINABLE_REMAINING_SECONDS = 300`（匹配加入窗口下限）。

### server/src/game/game.ts
- 新增 `joinableRemainingSeconds()`：搜打撤按 10 分钟限时计算剩余时间，
  其它模式用 600 秒兜底（普通 BR 实际由毒圈阶段约束，兜底不影响）；
- 新增 `joinableWindowOpen`：剩余时间 ≥ 5 分钟。

### 匹配过滤
- `gameManager.ts`（单线程）：`findGame` 过滤增加 `game.joinableWindowOpen`；
- `gameProcessManager.ts`（生产多进程）：`findGame` 过滤增加
  `procJoinableRemainingSeconds(proc) >= MIN_JOINABLE_REMAINING_SECONDS`
  （用房间快照的 `mapName` + `startedTime` 计算，与 Game 内逻辑一致）。

> 说明：只影响公开匹配（findGame），AI 补员、观战、邀请码/组队加入不受影响。

## 验证
- `test:v53-matchmaking-recovery`：更新 mock 为秒级时间，新增断言——
  已进行 7 分钟的搜打撤房（剩 3 分钟）不接收加入 token，玩家进入有人的早期局；
- server `tsc` / build：PASS；
- `test:extraction`、`test:all-modes`、`test:room-lifecycle`：PASS。
