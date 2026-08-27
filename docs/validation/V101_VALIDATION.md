# V101 验证记录

## 改动文件

- server/src/bot/humanSupport.ts（距离上限、追赶进度检查、距离过滤志愿）
- server/src/smartBot.ts（护送 tier、装备滞回、初始 readiness=0、latch 跟随、冷却）
- server/src/cooperationSmokeTest.ts（新规则与真实 tier 仲裁用例）

## 验证结果

| 检查项 | 结果 |
| --- | --- |
| server 构建（tsc） | PASS |
| test:cooperation | PASS |
| test:bot-brain | PASS |
| test:movement-jitter | PASS |
| test:faction-autofill | PASS |
| test:duel | PASS |
| test:v53-matchmaking | PASS |

## 行为确认（需重开 50v50 对局实测）

1. 玩家前压且身边 360 内有带枪 AI 时，约 1/4 的带枪 AI（不在战斗/治疗中）
   会持续向玩家靠拢，不再被搜刮/打箱子打断。
2. 护送不再因距离>160 或装备一帧抖动就瞬间解散；玩家短暂停下时 AI 仍会
   向玩家最后位置移动，7 秒后才解散。
3. 录像事件中 `human_support_started` 的 durationMs 应明显变长
   （不再是 0.1~1 秒）。