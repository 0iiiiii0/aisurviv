# V78 修复 ap_rounds 丢失 + 残血队友导致的乱晃

## 玩家反馈

1. AP Rounds 倍率效果的图标、描述、效果全部消失。
2. 队友残血时 AI 会到处晃。

## Bug 1：ap_rounds 图标/描述/效果消失

**根因**：拾取 perk 时 `addPerk(type, !isMistery)` 会把战利品 perk 标记为
`droppable=true`；而 `handleFactionModeRoles` 里有一个旧逻辑：当被分配的角色
自带 ≥4 个 perk（如 `last_man` 5 个、`woods_king` 7 个）时，**把所有 droppable
战利品 perk 全部 drop+remove**。于是玩家拿到 `ap_rounds` 后再获得这类角色，
ap_rounds 被直接删除——图标、描述（来自服务端 perk 列表）、穿甲/障碍物增伤效果
一并消失。

**修复（server/src/game/objects/player.ts）**：删除"角色 ≥4 perks 就丢弃全部
droppable 战利品 perk"的分支。角色分配现在只：
- 移除旧的 role-origin perk（未被重新授予的）；
- 丢弃并重新授予与角色 perk **冲突**的战利品 perk（以 role-origin 形式）；
- 无关的战利品 perk（ap_rounds、分裂弹等）原样保留，效果与图标都在。

## Bug 2：队友残血时 AI 到处晃

**根因（两处边界抖动）**：
1. **faction 伤亡比**：`injuredCount` 用 `health < 45` 硬阈值。队友血量在 45
   附近来回（受伤→治疗→再受伤）时，`casualtyRatio` 反复跨越 0.34/0.42/0.55，
   faction 指令在 attack/defend/withdraw 间翻转，全队目标反复变化 → 乱晃。
2. **自身撤退阈值**：战斗/撤退状态以 `health <= effectiveRetreatHealth` 硬切，
   血量在阈值附近治疗/受伤时 combat↔retreat 反复切换 → 原地晃动。

**修复**：
- `FactionCoordinator`：受伤迟滞。成员血量 <45 标记为受伤，直到恢复到 >55
  才清除（`injuredHigh` 集合，在 `updateBot` 维护）；`injuredCount` 改用该集合，
  血量在 45–55 区间震荡不会翻转全队指令。
- `smartBot`：撤退迟滞。一旦进入撤退状态（血量 ≤ 阈值），保持撤退直到血量
  恢复到 阈值+8 以上才允许回到战斗，消除边界反复横跳。

## 测试

- 新增 `test:perk-role-wander`：
  - `ap_rounds`（droppable 战利品）在 `last_man`（5 perk 角色）授予后仍保留，
    且保持 droppable 槽位；分裂弹同样保留；
  - faction 受伤迟滞：44 HP 标记受伤 → 治疗到 50 仍算受伤 → 恢复到 60 清除；
  - 源码断言：旧"丢弃全部 droppable"分支已删除、`injuredHigh` 存在、
    `retreatHysteresisActive` 存在。
- `test:savannah-perks`、`test:new-perks-port`、`test:v41-suite`（11 项）及
  V53–V77 全部回归 PASS；服务端/客户端构建 PASS。