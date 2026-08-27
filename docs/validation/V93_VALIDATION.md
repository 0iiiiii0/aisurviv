# V93 验证记录

## 改动文件

- client/src/inputBinds.ts
- client/index.html

## 验证结果

| 检查项 | 结果 |
| --- | --- |
| client 构建（vite） | PASS |
| server 构建（tsc） | PASS |
| test:sandevistan | PASS |

## 行为确认

1. sandevistan 模式默认按鼠标中键激活，不再占用 G 键（大地图恢复 G fallback）。
2. 设置 → 按键绑定列表中出现 "Sandevistan (斯安威斯坦)"，可自定义键位。
3. HUD 提示显示 [中键]。