# V97 验证记录

## 改动文件

- shared/gameConfig.ts
- server/src/sandevistanSmokeTest.ts

## 验证结果

| 检查项 | 结果 |
| --- | --- |
| server 构建（tsc） | PASS |
| client 构建（vite） | PASS |
| test:sandevistan | PASS |
| test:v41-suite（11 项） | PASS |

## 行为确认

1. 激活后 `worldTimeScale = 0.1`（世界以 10% 速度运行）。
2. 施法者保持全速；其余玩家/子弹/毒圈/空投按 10% 推进。
3. 结束后世界恢复全速；冷却/击杀减CD 等逻辑不变。