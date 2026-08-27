# V103 验证记录

## 改动文件

- server/src/game/weaponManager.ts（fireIntervalScale：cooldown × playerScale/worldScale）
- server/src/sandevistanSmokeTest.ts（新增第 14 节射击间隔测试 + 固定测试配置）

## 验证结果

| 检查项 | 结果 |
| --- | --- |
| server 构建（tsc） | PASS |
| test:sandevistan | PASS |
| test:duel / test:cooperation / test:bot-brain / test:reload-guard | PASS |

## 行为确认（需进 2077 模式实测）

1. 开启斯安威斯坦后，玩家枪械射击间隔按世界减速比例拉长：
   世界 0.2 → 真实间隔约为正常 5 倍（与世界中 AI/子弹减速一致）。
2. 关闭/未开启时射击节奏与普通模式完全一致。
3. 连发武器（burst）的 burst 间隔同步拉长。