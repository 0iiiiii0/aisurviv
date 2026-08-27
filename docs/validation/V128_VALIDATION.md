# V128 验证报告

## 变更范围

- `server/src/bot/humanSupport.ts`（新增）：前压检测/分兵/支援点/解散。
- `server/src/smartBot.ts`：真人追踪、前压识别、human-escort 意图与执行。
- `server/src/bot/decisionBrain.ts`：human-escort 意图。
- `server/src/game/objects/player.ts`：机器人始终接收本方真人队友对象更新。
- `server/src/gameServer.ts`：pureAiMatch 对局跳过公共自动补 AI。
- `server/src/cooperationSmokeTest.ts`：新增断言。

## 自动化测试

- server tsc --noEmit：PASS
- test:cooperation：PASS（含 6 组新断言：
  真人前压检测、1/4 确定性分兵、支援点在真人身后、解散条件、
  决策仲裁（护送 > 阵型/拾取，战斗 > 护送）、源码接线）
- test:combat-readiness / test:faction-autofill / test:smart-bot-brain：PASS

## 对局实测（faction / 8 normal AI / 模拟真人 WS 输入）

录制于 `server/ai-match-recordings/2026-08-01T21-19-22…`（e5618762）：

- 真人从出生点前压，机器人判定
  `pushing=true human-advancing-under-fire`；
- `human_support_started`（bot 1，t=45s，reason=escort-pushing-human）；
- `human_support_ended`（t=54s，reason=human-too-far，时长 9530ms）——
  真人持续全速奔跑导致距离超标，属于预期解散；
- 修复前真人跑出机器人视野后位置冻结（实测确认），修复后
  FULL/PART 对象流持续同步真人位置。

## 说明

- 指派为确定性哈希（跨 worker 无需共享内存），约 1/4 有装备 AI；
- 真人停止推进 7 秒、死亡/倒地或距离超 160u 时护送自动解散；
- 护送意图让位于战斗（可见敌人）、治疗与紧急阵营指令。
