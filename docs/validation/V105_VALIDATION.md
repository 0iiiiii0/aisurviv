# V105 验证记录

## 改动文件

- server/src/smartBot.ts（holdToFire 辅助 + 13 处 burst 开火修复；弹药评分/备弹目标/拾取判定）
- server/src/lootFireFixSmokeTest.ts（新增回归测试）
- server/package.json（test:loot-fire-fix）

## 验证结果

| 检查项 | 结果 |
| --- | --- |
| server 构建（tsc） | PASS |
| test:loot-fire-fix | PASS |
| test:bot-brain / test:cooperation / test:loot-safety / test:loot-ai / test:duel / test:reload-guard / test:sandevistan | PASS |

## 行为确认（需重新开局实测）

1. 机器人拿到枪后，会把枪旁边两组弹药都吸完再走（期望备弹 85%）。
2. 使用 m93r/famas 等 burst 武器时能持续开火，不再来回切枪。
3. 密集掉落（枪+双弹药）拾取更稳，不再"no-distance-progress"后放弃。