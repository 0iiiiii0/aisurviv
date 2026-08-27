# V112 验证报告

## 变更范围

- `server/src/game/objects/obstacle.ts`：门/按钮延迟动作改为世界时间推进。
- `server/src/game/map.ts`：`timedObstacles` + `update(worldDt)`。
- `server/src/game/game.ts`：`map.update(worldDt)`。
- `client/src/objects/obstacle.ts`：开门动画随世界时间膨胀减速。
- `server/src/sandevistanSmokeTest.ts`：新增自动门减速断言。

## 自动化测试

| 命令 | 结果 |
| --- | --- |
| server `tsc` | PASS |
| client `tsc --noEmit` + `vite build` | PASS |
| `test:sandevistan`（含新增自动门减速用例） | PASS |
| `test:v41-suite`（11 项） | PASS |
| `test:v52-building-walls` | PASS |

## 关键断言（test:sandevistan 第 12 节）

- 自动门 `autoCloseDelay = 1`（世界秒）。
- 未激活：`map.update(0.4)` 门仍开；`map.update(0.7)` 门关闭（正常 1s）。
- 激活（`sandevistanTimeScale() = 0.1`）：`map.update(0.5)`×2
  （模拟 10 真实秒 = 1 世界秒）后才关闭，验证门互动 10 倍减速。
- 关闭后全玩家停用，世界恢复全速（scale = 1）。

## 结论

- 斯安威斯坦激活期间，自动门的开启/关闭节奏、按钮门的延迟均按世界时间
  减速（约 10 倍），客户端开门动画同步放慢，观感一致。
