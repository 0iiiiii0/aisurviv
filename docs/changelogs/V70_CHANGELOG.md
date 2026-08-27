# V70 无武器 / 弹药不足的 AI 不参战

## 需求

- 没有武器的 AI 不要去战斗。
- 武器没有足够弹药的 AI 也不要去战斗。
- 全模式生效（不只 50v50）。

## 现状与问题

- 旧的 `factionUnarmedCombatPolicy` 只在 **faction 模式**下让无枪 bot 转去找枪，
  solo/duo/squad 里无枪 bot 仍然主动接战。
- `usableGunCount` 只要弹匣里还有 1 发就算"可用"，没有"弹药是否够打"的判定——
  弹匣接近空/无备弹的 bot 会拿着打不响的枪去接战。

## 实现

### 策略层（server/src/bot/resourceCombatPolicy.ts）
- `factionUnarmedCombatPolicy` 改为**全模式**：`prioritizeWeaponSearch =
  usableGunCount<=0 || !combatAmmoSufficient`（不再依赖 factionMode）。
- 新增可选入参 `combatAmmoSufficient`（向后兼容，缺省按"已持枪"处理）。

### 机器人层（server/src/smartBot.ts）
- 新增 `hasSufficientCombatAmmo()`：任一主/副武器满足
  `弹匣+备弹 >= floor`（floor = min(8, max(2, 弹匣容量×25%))）才算弹药充足；
  无限弹药/对局模式视为充足。
- 策略调用传入 `combatAmmoSufficient`。
- 战斗意图门控：`prioritizeWeaponSearch` 时**不主动接战**；唯一例外是敌人贴脸
  近战（`immediateMeleeThreat`），此时仍强制自卫（emergency + critical）。
- 武器搜索意图 reason 改为全模式通用："evade-and-find-firearm-or-ammo" /
  "find-firearm-or-ammo"（此前文案带 faction 前缀）。

## 测试

- 新增 `test:combat-readiness`：
  - 无枪 bot 全模式拒绝接战（solo 与 faction 一致）；
  - 弹药充足 → 允许接战；
  - 弹药不足 → 拒绝接战、转去找枪/弹药；
  - 缺省入参向后兼容（有枪即接战）；
  - 贴脸近战仍触发 `immediateMeleeThreat`（自卫例外，`allowCombat` 仍为 false）；
  - 源码断言：`hasSufficientCombatAmmo`、`combatAmmoSufficient` 接线、
    `forcedMeleeSelfDefense` 自卫门、全模式 reason 文案。
- `test:v22-resource-combat`（旧策略行为，兼容）通过。
- `test:v41-suite`（11 项）及 V53–V69 全部回归通过。
- 真实 solo 对局（8 bot、150s）：combat 状态占比 0.9%，无回归；
  8 帧"低弹药接战"核对后均为策略允许（霰弹枪弹匣≥2 或 m9≥5，且帧内不含库存备弹）。