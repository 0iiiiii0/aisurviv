# V85 验证记录

## 改动文件

- server/src/config.ts
- server/src/botAutoFill.ts
- server/src/game/gameManager.ts
- server/src/adminServer.ts
- client/public/admin/index.html
- client/public/admin/admin.js
- client/public/admin/admin.css
- server/src/adminSmokeTest.ts
- server/src/botAutoFillConfigSmokeTest.ts
- server/src/factionAutoFillSmokeTest.ts
- server/src/v50UnifiedTargetDuelAdminSmokeTest.ts

## 验证结果

| 检查项 | 结果 |
| --- | --- |
| server 构建（npm run build / tsc） | PASS |
| client 构建（tsc --noEmit && vite build） | PASS |
| test:v50-room-targets | PASS |
| test:admin | PASS |
| test:bot-autofill-config | PASS |
| test:faction-autofill | PASS |
| test:sandevistan | PASS |
| test:v41-suite（11 项） | PASS |
| test:v53-matchmaking | PASS |
| test:worker-thread-room | PASS |

## 行为确认

1. "房间管理"模块上半部分：人数设置面板并排展示
   （公开房间人数上限：单排/双排/四排；真人+AI 补齐目标：单人/双人/四人/50v50）。
2. "人机自动补入"模块不再显示每模式网格与单一补齐目标输入，
   只保留 AI 加入间隔、类型占比与运行频率。
3. 补齐目标按模式独立生效：普通模式目标被房间人数上限钳制，
   50v50 使用独立目标（默认 80）。
4. 旧配置（V80 共享 targetPlayerCount）迁移后四个目标可用，行为不缩水。