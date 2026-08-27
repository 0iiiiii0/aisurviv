# V108 验证记录

## 改动文件

- server/src/game/objects/player.ts（倒地队友强制可见）
- server/src/smartBot.ts（真人救援 emergency 优先级 + 55m 距离）
- server/src/cooperationSmokeTest.ts（源码守卫）

## 验证结果

| 检查项 | 结果 |
| --- | --- |
| server 构建（tsc） | PASS |
| test:cooperation（含新守卫） | PASS |
| test:extraction / loot-fire-fix / duel / all-modes / v53-matchmaking / bot-brain / v51-medic-revive / revive-coordination | PASS |

## 行为确认（需重开对局实测）

1. 真人队友倒地后，同队最近的 AI（即使正在打箱子/找枪）会中断当前行为
   跑过去救援；20~50m 内的 AI 都能响应。
2. AI 持续走向倒地玩家（不再因视野抖动而反复切换意图）。