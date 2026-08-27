# V89 验证记录

## 改动文件

- shared/gameConfig.ts（protocol 87 + Input.Sandevistan）
- client/src/inputBinds.ts（G 键绑定）
- client/src/game.ts（发送 Input.Sandevistan）
- client/index.html + client/css/game.css（[G] 按键提示）
- server/src/game/objects/player.ts（handleInput 激活）
- server/src/sandevistanSmokeTest.ts（输入链路断言）

## 验证结果

| 检查项 | 结果 |
| --- | --- |
| server 构建（tsc） | PASS |
| client 构建（vite） | PASS |
| test:sandevistan（含 G 键输入激活） | PASS |
| test:v41-suite（11 项） | PASS |
| test:bot-input | PASS |
| test:v53-matchmaking | PASS |

## 行为确认

1. sandevistan 模式下按 G 键可激活（冷却就绪时）。
2. 激活后世界减速 0.35、HUD 显示剩余时间、全屏蓝调。
3. 冷却中按 G 不生效；非 sandevistan 模式不生效。
4. 键位可在游戏设置中重新绑定。