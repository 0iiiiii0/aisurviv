# V102 验证记录

## 改动文件

- server/src/gameServer.ts（simulateHuman 请求字段 + 模拟真人生成 + spawnGameBot 透传）
- server/src/smartBot.ts（BOT_SIMULATED_HUMAN 脚本化前压驱动 + updateHumanTrack 跳过自身）
- server/src/aiCapabilityTest.ts（AI_TEST_SIMULATE_HUMAN / AI_TEST_PORT、房间自关统计、报告 humanSupport 段）

## 验证结果

| 检查项 | 结果 |
| --- | --- |
| server 构建（tsc） | PASS |
| test:cooperation / test:bot-brain / test:ai-capability-match / test:duel / test:v53-matchmaking | PASS |
| 全 AI 50v50 + 模拟真人实测（24 bots） | 稳定运行 133s，真人死亡后房间正常结束 |
| 护送触发 | 13 次 start/end，5 个 AI 参与，escort 意图帧 176 |
| 护送持续时间 | 8s~46s（事件级），无 0.1~1 秒秒散 |
| 装备滞回 | escort-lost-equipment = 0 |

## 备注

- 模拟真人（serverBot=false 的 smartBot 工人）仅用于自动化测试；
  实际真人玩家行为不受影响。
- 纯 AI 对局（不设置 AI_TEST_SIMULATE_HUMAN）行为与之前一致。