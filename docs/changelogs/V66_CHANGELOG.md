# V66 AI disconnect resilience + self-revive last-stand refinement

## AI 掉线优化（断线自动恢复 + 超时清理）

- **smartBot 自动重连**：`TacticalBot` 把 WebSocket 生命周期收进
  `openSocket()`，断线后不再直接判定死亡，而是按指数退避
  （`BOT_RECONNECT_BASE_DELAY_MS`，默认 1.5s，封顶 16 倍）自动重连
  到同一个 `gameId`，最多 `BOT_RECONNECT_ATTEMPTS`（默认 8）次。
- **服务端 resume**：`addPlayer()` 先按 `matchPriv` 查找仍处于
  `disconnected` 的同一选手，命中则把新 socket 绑定到原 player 对象并清掉
  `disconnected`/`disconnectAt`，不会产生重复选手，位置、背包、队伍全部保留。
  人类玩家断线重连同样受益。
- **心跳看门狗**：`checkConnectionWatchdog()` 检测服务端包空闲
  （`BOT_RECONNECT_IDLE_MS`，默认 20s），半开连接会被强制断开并重连。
- **断线清理**：`Game.update()` 每秒检查，断线超过
  `GameConfig.player.disconnectTimeout`（默认 30s）的选手会被 `removePlayer`
  移除，释放队伍/房间名额，避免僵尸 AI 卡住对局、阻止自动补位。
- **机器人不即时移除**：`handleSocketClose()` 对 `serverBot` 不再走
  `minActiveTime` 即时移除分支，给重连留出窗口。
- 顺带修复 `removePlayer()` 未从 `team.players/team.livingPlayers` 移除选手
  的潜在 bug（阵营模式僵尸名额），并清理 `socketIdToPlayer` 旧绑定。

## self_revive 保留“最后翻盘”机会

- 按新版上游行为（`Group.checkSelfRevive`）移植到 `Team`/`Group`：
  - 无 self_revive：全队倒地立即判负（保留 V65 修复，不再等 ~40s 流血）。
  - 有 self_revive：最后一员倒地时先进入倒地状态而不是立即判负；当所有
    拥有自救能力的成员真正死亡（被补掉/流血）后才判负，保留自救翻盘窗口。
- `handlePlayerDeath()` 的 Team/Faction 分支同步改为
  `checkAllDowned(player) && !checkSelfRevive()` 才连锁淘汰；
  倒地阶段补掉队友时同样只在无人可自救时才把剩余倒地队友一并带走。

## 配置

- `GameConfig.player.disconnectTimeout`（秒，默认 30）
- 环境变量：`BOT_RECONNECT_ATTEMPTS`、`BOT_RECONNECT_BASE_DELAY_MS`、
  `BOT_RECONNECT_IDLE_MS`