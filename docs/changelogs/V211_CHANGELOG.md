# V211 修复搜打撤邀请组队进入错误模式

## 问题

客户端「搜打撤 · 邀请组队」发送 extraction-duo 索引（39），但服务端
`isRegularTeamMode()` 排除了 extraction，`addRoom` 回退到第一个普通
duo（Main Duo）——进入错误模式。

## 修复（server/src/teamMenu.ts）

- 新增 `isTeamModePlaylist()`：可邀请组队的 duo/squad 列表
  **包含 extraction**（仍排除 faction / sandevistan / aim_training）；
- `addRoom`：
  - 优先保留请求的模式（extraction duo 39 直接生效）；
  - 未知/失效索引回退到**常规模式第一**（通常 main duo）；
- create 可用性检查改用 `isTeamModePlaylist`。

## 验证

- 搜打撤邀请组队（gameModeIdx=39）→ 房间保留 39、maxPlayers=2 ✓
- 普通 Create Team（gameModeIdx=0）→ 仍回退 main duo（1）✓
- server tsc / test:admin / test:all-modes：PASS
