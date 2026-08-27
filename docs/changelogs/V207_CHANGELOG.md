# V207 撤离点改为开局固定分配（修复永远无法撤离）

## 问题

服务端/客户端每帧按玩家「当前位置」重算最远撤离点：接近目标后标记
立即切到其他点位（点位间距 59/135，圈直径仅 7），正常情况无法站在
圈内完成撤离。

## 修复

### 服务端（server/src/game/extractionSystem.ts）
- **开局固定分配**：每个玩家（组队时全队共享）首次按出生点最远点
  分配一个撤离点索引，**整局不变**；
- `activePointFor(player)` 恒返回固定点（不再随移动切换）；
- **权威进度同步**：每 0.2s 向玩家发送点索引 + 停留进度
  （ExtractionPointMsg），站够 5 秒由服务端判定撤离。

### 共享（shared/net/extractionPointMsg.ts + gameConfig.ts）
- 新增 `ExtractionPointMsg`（pointIndex + holdSeconds）；
- `MsgType.ExtractionPoint`；`protocolVersion` 88 → 89。

### 客户端（game.ts / ui.ts / player.ts）
- 接收消息：世界光柱与小地图标记使用服务端固定点
  （未同步前回退最远点算法）；
- 撤离进度条使用**服务端权威值**（不再本地计时）。

## 验证

- 固定点断言：玩家移动 300 码后点索引不变 ✓
- server tsc / client build / test:extraction（新增断言）/
  test:v42 / test:puzzle-door：PASS
