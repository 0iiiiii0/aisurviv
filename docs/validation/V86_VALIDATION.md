# V86 验证记录

## 改动文件

- client/public/admin/index.html
- client/public/admin/admin.js
- client/public/admin/admin.css

## 验证结果

| 检查项 | 结果 |
| --- | --- |
| client 构建（tsc --noEmit && vite build） | PASS |
| server 构建（tsc） | PASS |
| test:v50-room-targets | PASS |
| test:admin | PASS |
| test:all-modes | PASS |
| test:v41-suite（11 项） | PASS |

## 行为确认

1. 模式配置顶部出现"特殊模式开关"栏位，包含 50v50 / 2077·斯安威斯坦 /
   1v1随机 / 1v1房间 四个开关，位于普通模式网格上方。
2. 50v50 开关切换 faction 模式；2077 开关统一切换 sandevistan 三个队伍规格。
3. 1v1 两个开关与 1v1 配置面板内的开关双向同步。
4. 普通模式网格中的开关状态与特殊栏位一致（同一数据源）。