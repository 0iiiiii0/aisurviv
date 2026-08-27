# V104 验证记录

## 改动文件

- shared/gameConfig.ts（speedBonus 0）

## 验证结果

| 检查项 | 结果 |
| --- | --- |
| server 构建（tsc） | PASS |
| client 构建（vite） | PASS |
| test:sandevistan | PASS |
| test:v41-suite（11 项） | PASS |

## 行为确认

1. 激活斯安威斯坦后玩家移速=基础移速（无 +20%）。
2. 世界减速 10%、残影/后处理/冷却等不变。