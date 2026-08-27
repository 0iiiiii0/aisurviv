# V232 修复真人撤离后后台真人数量不变

## 问题
- 搜打撤真人成功撤离后，后台「房间管理」显示的真人数量（humanPlayerCount）
  一直不变。
- 原因有两个：
  1. `humanPlayerCount` 基于 `playerBarn.players`，只排除
     `disconnected / spectatorOnly / serverBot`；而 `extractFromMatch`
     只把玩家移出 `livingPlayers`，玩家仍留在 `players` 且未断线
     → 计数不降；
  2. `extractFromMatch` 没有调用 `game.updateData()`，而普通死亡（`kill()`）
     会调用——生产多进程下房间快照不刷新，后台一直显示撤离前的旧人数。

## 实现

### server/src/game/objects/player.ts
- Player 新增 `extracted` 标志，`extractFromMatch()` 中置为 true；
- `extractFromMatch()` 末尾补充 `this.game.updateData()`（与 `kill()` 一致，
  同步父进程快照）。

### server/src/game/game.ts
- `humanPlayerCount` / `aiPlayerCount` / `serverBotCount` /
  `connectedHumanCount` / `connectedServerBotCount` 全部排除
  `player.extracted`（撤离玩家已离开本局，不再计入）。

## 验证
- `test:extraction`：新增断言——真人撤离后 `humanPlayerCount === 0`；
- `test:room-lifecycle`、`test:v53-matchmaking-recovery`：PASS；
- server `tsc` / build：PASS（`dist` 已更新）。
