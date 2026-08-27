# V121 验证报告

## 变更范围

- `server/src/gameServer.ts`：新增 `/api/spectate/rooms`、`/api/spectate/join`
  公开接口与房间信息组装。
- `client/index.html`：主菜单“观战”按钮 + 观战大厅弹窗。
- `client/src/ui/spectateLobby.ts`：新增观战大厅逻辑。
- `client/src/main.ts`：接入 SpectateLobby。
- `client/css/duel-lobby.css`：观战列表样式。

## 自动化测试

- server tsc --noEmit：PASS
- client tsc --noEmit：PASS
- vite build：PASS

## 端到端实测

1. `GET /api/spectate/rooms`（无房间）：`{"games":[]}`。
2. 创建纯 AI 1v1（2 名 AI 进场后）：
   - 房间出现在列表中：`duel_ai 1v1`、alive=2、AI=2、maxPlayers=2。
3. `POST /api/spectate/join`：
   - 返回 `matchData`（gameId + 观战令牌 + hosts/addrs）。
4. 使用观战令牌连接 `ws://.../play?gameId=...`：
   - 收到 Joined 消息，观战成功；
   - 服务器 `spectatorCount` 0→1，alive/真人/AI 计数不变。
5. 非法房间：`{"err":"房间不存在或已结束"}`。

## 说明

- 观战走既有 spectator token 机制：观众不计入真人/AI，不参与队伍与胜负，
  可正常切换观战目标 / 自由视角 / 分层与障碍物透明。
- 房间列表仅展示“未结束且至少 1 名存活玩家”的房间；对局结束后自动消失。
