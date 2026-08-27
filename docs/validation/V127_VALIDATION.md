# V127 验证报告

## 变更范围

- `server/src/bot/resourceCombatPolicy.ts`：装备分级与遭遇策略纯函数。
- `server/src/smartBot.ts`：决策循环接入分级；规避移动；战斗门槛。
- `server/src/combatReadinessSmokeTest.ts`：策略断言。

## 自动化测试

- server tsc --noEmit：PASS
- test:combat-readiness：PASS（含 9 组新断言）
- test:combat-tactics / test:forbidden-combat / test:forbidden-context：PASS
- test:loot-strategy / test:integrated-spec / test:new-behavior-port /
  test:bot-brain / v36-tactics-sim：PASS

## 对局实测（main / 单人 / 12 normal AI / 150s）

录制于 `server/ai-match-recordings/2026-08-01T20-51-17…`（8e2fd6a9）：

- 无武器阶段 combat 占比 3.7%（点 blank / 肉搏贴脸自卫）；
- 弱枪阶段主动 combat 占比 **0.5%**（此前策略下与好枪相同）；
- 好枪阶段 combat 2.6%；
- `find-firearm-or-ammo` 意图 30 次、
  `evade-and-find-firearm-or-ammo`（逃离式找枪）10 次。

## 说明

- 等级 1 的 counterfire（3.3%）是“被射击时还手”，属于被逼自卫，
  不是主动接战；
- 装备分级依据枪械等级（S+/S/A/B=好枪，C/D/F=弱枪）且要求有弹药。
