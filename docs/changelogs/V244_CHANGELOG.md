# V244 全模式重连入局：3 分钟窗口 + 对局网址持久化

## 需求
- 3 分钟内只要玩家人物模型**没彻底死**就可以重连入局（刷新页面 / 换网络 /
  换 IP 输入当前网址都能连回原对局）；
- 局内网址不再只有端口：进入对局后把 gameId + token 写进网址，
  刷新后不会回到大厅；
- **最新连接视为有效**：同一对局同一玩家有多个连接时，新连接顶掉旧连接；
- 真人掉线不视为"没有真人"：房间不会因真人掉线而被删除。

## 实现

### 服务端
- `shared/gameConfig.ts`：新增 `player.reconnectTimeout = 180`（真人 3 分钟
  重连窗口；bot 仍用 `disconnectTimeout = 30`）；
- `game/game.ts`：
  - 断线清理按身份区分超时：真人 180s、bot 30s；
  - `handleSocketClose` 不再立即移除刚加入的真人（对局开始前掉线也保留在
    重连窗口内）；
  - 新增 `pendingHumanCount`（掉线未阵亡真人），`updateBotOnlyShutdown`
    把这类真人视为"有真人"，房间不关闭；
- `game/objects/player.ts`：`addPlayer` 重连增强——
  - 同一 match token 已有**活跃连接**时，新连接直接接管（断开旧 socket，
    最新连接有效）；
  - 人物已彻底死亡（非观战者）重连被拒绝；
- `game/roomLifecycle.ts`：`BotOnlyRoomState` 增加
  `disconnectedAliveHumanCount`，掉线未阵亡真人使房间保持存活。

### 客户端（main.ts）
- 进入对局时把 `gameId / token / hosts / addrs / useHttps` 写入当前 URL
  （`persistMatchUrl`），刷新后从 URL 恢复并**自动加入原对局**；
- 启动检测持久化对局 URL（`tryJoinPersistedMatch`）：带 gameId + token
  直接 `joinGame`，不重新匹配；hosts 缺失时用当前页面 host 直连
  （换 IP 输入同一网址也能连到原服务器）；
- 连接被服务器关闭时最多自动重连 3 次（递增退避），保留对局 URL；
  主动退出 / 结算 / 加入失败时清除 URL（`clearMatchUrl`），避免旧链接反复重试。

## 验证
- 新增 `server/src/reconnectSmokeTest.ts`（`test:reconnect`）：
  掉线重连复用同一玩家对象、最新连接顶掉旧连接、阵亡拒绝重连、
  掉线未阵亡真人计入 pendingHumanCount；
- `roomLifecycleSmokeTest` 增加"掉线未阵亡真人保持房间存活"断言；
- server `tsc` PASS；client `vite build` PASS。
