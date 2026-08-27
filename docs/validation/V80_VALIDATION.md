# V80 验证记录

## 改动文件

- server/src/config.ts
- server/src/botAutoFill.ts
- server/src/game/gameManager.ts
- server/src/adminServer.ts
- client/public/admin/index.html
- client/public/admin/admin.js
- server/src/botAutoFillConfigSmokeTest.ts
- server/src/factionAutoFillSmokeTest.ts
- server/src/v50UnifiedTargetDuelAdminSmokeTest.ts
- server/src/adminSmokeTest.ts

## 验证结果

| 检查项 | 结果 |
| --- | --- |
| server 构建（npm run build / tsc） | PASS |
| client 构建（tsc --noEmit && vite build） | PASS |
| test:bot-autofill-config | PASS |
| test:faction-autofill | PASS |
| test:admin | PASS |
| test:v50-room-targets | PASS |
| test:v41-suite（11 项） | PASS |
| test:v53-matchmaking | PASS |
| test:worker-thread-room | PASS |

## 行为确认

1. 后台"AI补入配置"只剩一个补齐目标输入：真人+AI补齐目标（所有普通公开房间共用，含50v50）。
2. AI 加入间隔仍为全局统一值（`defaultJoinIntervalMs`）。
3. 每个模式实际目标 = min(全局目标, 房间上限)，不会超过房间人数上限。
4. 默认全局目标 80：普通模式（上限 20）补齐到 20；50v50（上限 100）补齐到 80。
5. 旧配置（V76 四目标 / V15-V49 legacy 上限）迁移合并为 max 值，升级不缩水。