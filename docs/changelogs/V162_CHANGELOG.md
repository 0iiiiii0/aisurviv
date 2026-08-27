# V162 修复常规模式 Create Team（邀请码队伍）

## 需求

大厅常规模式的 Create Team 应正常可用：即使普通双人/四人房间在后台
设为"未公开"（不进公开匹配），仍应能通过邀请码创建并开始对局。

## 根因

- 上一轮将队伍房间限定为"已启用的 duo/squad playlist"，而常规模式
  （main/potato/woods…）的双人/四人全部是"未公开"（enabled=false），
  导致 Create Team 回退到 faction / 搜打撤 duo；
- `findGame` 对 `enabled=false` 的模式一律拒绝，即使团队房间想玩
  "未公开"模式也会失败。

## 实现

### 服务端（server/src/teamMenu.ts）
- 新增 `isRegularTeamMode()`：可邀请组队的模式 = 常规地图（非 faction、
  非 extraction、非 sandevistan、非 aim_training）的 duo/squad，
  **不要求 enabled**（未公开 ≠ 不可邀请）；
- 创建房间回退到第一个常规 duo（main duo，索引 1），
  `enabledGameModeIdxs` 返回全部常规 duo/squad 索引；
- `playGame` 请求携带 `teamRoom: true`。

### 匹配放行（server/src/gameServer.ts + game/gameManager.ts）
- `FindGameBody` 新增可选 `teamRoom`；
- `findGame` 的 enabled 检查改为
  `!mode.enabled && !body.teamRoom` 才拒绝：
  公开随机匹配仍只能进已启用模式，邀请码队伍可玩"未公开"模式。

### 客户端（client/src/ui/teamMenu.ts）
- 双人/四人按钮改为定位第一个**常规** duo/squad playlist
  （忽略 enabled，排除 faction/extraction/sandevistan）；
- 选中态按房间模式是否为常规 duo/squad 判断，
  支持直接进入未公开的普通双人/四人。

## 验证

- 普通玩家 Create Team（gameModeIdx=0）→ 房间
  `gameModeIdx=1`（main duo）、`maxPlayers=2`、
  `enabledGameModeIdxs` 含全部常规 duo/squad ✓
- 切换到四人（main squad，未公开）→ playGame
  → `joinGame` 成功返回 gameId ✓
- server tsc / client tsc + vite build：PASS
- test:admin / test:extraction：PASS
