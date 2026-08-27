# V96 验证记录

## 改动文件

- shared/defs/maps/sandevistanDefs.ts
- client/src/siteInfo.ts
- client/css/app.css

## 验证结果

| 检查项 | 结果 |
| --- | --- |
| client 构建（vite） | PASS |
| server 构建（tsc） | PASS |
| test:sandevistan | PASS |
| test:v41-suite（11 项） | PASS |

## 行为确认

1. 主界面开启 2077·斯安威斯坦 后，模式按钮显示荧光黄背景 +
   青蓝 "2077" 数字徽章（带高光与数字间连接线），赛博朋克 HUD 风格。
2. 按钮文字（斯安威斯坦 · 单人）与徽章并排显示。
3. 其它模式按钮样式不受影响。