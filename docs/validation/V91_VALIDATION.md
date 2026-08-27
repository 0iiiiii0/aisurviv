# V91 验证记录

## 改动文件

- client/public/admin/index.html
- client/public/admin/admin.js
- client/public/admin/admin.css
- server/src/v50UnifiedTargetDuelAdminSmokeTest.ts

## 验证结果

| 检查项 | 结果 |
| --- | --- |
| server 构建（tsc） | PASS |
| client 构建（vite） | PASS |
| test:v50-room-targets | PASS |
| test:admin | PASS |
| test:v41-suite（11 项） | PASS |

## 行为确认

1. 纯 AI 1v1 卡片更紧凑，占用垂直空间明显减少。
2. 1v1 配置面板不再有"随机1v1模式 / 1v1房间模式"开关；
   统一由特殊模式组的"1v1 随机 / 1v1 房间"卡片控制。
3. 特殊模式组"2077 · 斯安威斯坦"只切换 sandevistan 单人（Normal 单人）。
4. 后台无残留的 duel-random-mode-enabled / duel-room-mode-enabled 引用。