# V100 验证记录

## 改动文件

- server/src/bot/grenadeDodge.ts（新增，纯函数 `chooseGrenadeEscape`）
- server/src/smartBot.ts（新增 `grenadeSeenAt` 首见时间表、`grenadeThreatVector`、
  决策循环新增手雷躲避分支）
- server/src/grenadeDodgeSmokeTest.ts（新增强制测试）
- server/package.json（新增 `test:grenade-dodge`）

## 验证结果

| 检查项 | 结果 |
| --- | --- |
| server 构建（tsc） | PASS |
| test:grenade-dodge | PASS |
| test:bot-brain | PASS |
| test:movement-jitter | PASS |
| test:loot-safety | PASS |
| test:forbidden-ai | PASS |
| test:throwable-tactics | PASS |
| test:duel | PASS |
| test:ai-recorder | PASS |
| test:v53-matchmaking | PASS |
| test:airstrike-safety | PASS |
| test:gas-escape | PASS |

## 行为确认（需重开对局实测）

1. 手雷/集束雷/殉爆落地在 AI 附近时，AI 应朝远离预估落点的方向移动。
2. 不同楼层的手雷不触发（layer 过滤）。
3. 过期/已消失的投射物不会让 AI 永久逃跑。
4. 打药/救人中遇到手雷会先取消动作再逃跑。