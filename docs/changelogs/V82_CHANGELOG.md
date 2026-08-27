# V82 修复 LEGIT / HACKER AI 命中率低

## 需求

- 用户反馈 LEGIT（人类极限）和 HACKER（作弊级）AI 命中率低。

## 根因

- LEGIT / HACKER 的权威战斗（`handleForbiddenCombat`，基于服务器每 ~10ms 生成的
  `forbidden-context` 精确敌人快照做子弹拦截预测）**只在 1v1（duel）模式启用**。
- 在普通吃鸡 / 50v50 等模式中，它们的主战斗路径（`combat()`）只用**本地
  object-pool 快照**预测：位置比服务器真实位置滞后一个服务器 tick + 网络时间，
  敌人速度也来自本地采样。对移动目标，这种滞后会变成**系统性的提前量不足**，
  子弹总是落在目标身后 → 命中率明显偏低。
- 服务器端权威 context 在普通模式其实也一直在生成（AI 每 tick 请求），但此前
  只在 duel 主路径和"最终兜底扳机"里被消费，普通战斗的主瞄准完全没用到。

## 实现（server/src/smartBot.ts）

- 新增 `authoritativeEnemyObservation(enemyId, timestamp)`：
  - 仅对 `forbidden` / `legit` 生效；
  - context 新鲜（生成时间距现在 ≤ 240ms）且敌人存在时，返回服务器的权威
    `pos` / `velocity` / `layer`；
  - context 缺失或过期时返回 null（自动回退本地数据，不影响其它模式）。
- `combat()` 主战斗路径：
  - `enemyPos` / `enemyVelocity` 优先使用权威快照；
  - 构造 `effectiveTargetMemory` 传入 `stableCombatAimDirection`，
    让子弹拦截点用权威位置 + 权威速度计算，并按其生成时间做观测年龄补偿。
- duel 模式行为不变（原本就走权威路径）；普通难度（normal/hard/pro）不受影响。

## 验证

- server 构建（tsc）通过。
- 相关 AI 测试全过：forbidden-context、forbidden-ai、aim-control、bot-brain、
  combat-tactics、perk-role-wander、scope-suppression、collective-sim、v40-duel-recovery、
  v46-replay-ai、v53-matchmaking、worker-thread-room、ai-capability-match、
  test:v41-suite（11 项）全部 PASS。

## 说明

- 移动/后坐力散布（moveSpread / shotSpread）是服务器端物理机制（真人也同样
  受限），本次未改动，避免 AI 战术退化（站着不动被打）。
- 若后续仍觉得命中率不足，可再评估"精度站桩（precisionStance）期间严格要求
  停稳再开火"。