# V249 网络波动自动重连（保留画面，不再掉线回大厅）

## 需求
- 经常因网络波动失去连接（服务器未崩溃）——断线时应自动重连，而不是掉线。

## 实现

### 客户端（game.ts / main.ts / game.css）
- `Game.enableAutoReconnect(url, matchPriv, ...)`：进入对局时记录连接参数；
- ws 断线（网络波动、服务器未主动断开）时**保留画面自动重连**：
  - 不再直接回大厅（不再触发 onQuit），屏幕中央显示「网络波动，正在自动重连…」；
  - 递增退避重连（1s / 2s / 4s / 8s…），最多 20 次（约 4 分钟）；
  - 重连复用同一 match token，服务端恢复同一玩家；
  - 重连成功（收到 Joined）时先清理本地世界（`free(true)` 保留新连接），
    再重新初始化接收服务器重发的完整快照；
  - 对局结束 / 主动退出（`free()`）自动停止重连；
- `main.ts`：`joinGame` 时调用 `enableAutoReconnect`；移除旧的「回大厅再重连」
  逻辑（3 次限制），由 game 内部无缝重连接管。

### 服务端（player.ts）
- `addPlayer` 复用玩家重连时重置 `_firstUpdate = true` 与
  `initialFullSyncsRemaining = 3`：服务器向重连玩家**重发完整初始快照**
  （Joined + Map + 前几帧全量 Update），客户端（刷新或网络恢复）都能重建
  一致的世界状态。

## 验证
- `reconnectSmokeTest` 新增断言：重连后 `_firstUpdate=true`、
  `initialFullSyncsRemaining=3`（完整快照重新武装）；
- server `tsc` PASS；client `vite build` PASS（dist 已更新）。
