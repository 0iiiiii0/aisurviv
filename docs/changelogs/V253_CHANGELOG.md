# V253 确定并修复绝密 AI 掉落物

## 绝密 AI 掉落物（确认后）
击杀绝密 AI 掉落：
- **武器**：当前配装武器（绝密配装 M4A1 / SV98 / M249，或 last_man 兜底补的
  M249）；
- **弹药 / 药品**：配装弹药（556mm / 308sub 等）与药品（绷带 / 医疗包 /
  汽水 / 止痛药）；
- **护甲 / 倍镜**：三级护甲（helmet03 / chest03）、背包（backpack02 / 03）、
  倍镜（2x / 4x / 8x）；
- **能力**：击杀后 **1/5 概率**额外随机掉落一个能力（SECRET_DROP_PERKS，
  共 19 种：endless_ammo / ap_rounds / steelskin / small_arms / firepower /
  combat_stims / splinter / lifeline / gotw / windwalk / flak_jacket /
  broken_arrow / self_revive / scavenger / field_medic / takedown /
  chambered / targeting / explosive）；
- 不掉：1x 倍镜、拳头、投掷物（MIRV 清空不掉）。

另：绝密模式下地图高级物资（S/S+ 武器、AWM 弹药、信号弹/信号枪、
8x/15x 倍镜）权重 ×3（普通搜打撤为 ×0.1）。

## 修复的问题
- 之前绝密 AI 的 last_man 专属能力（**无限子弹 endless_ammo**、钢铁皮肤
  steelskin、分裂弹 splinter、角色能力）被 `addPerk(perk, true)` 标记为
  **可掉落**，击杀后会全部掉落到地面，玩家可白捡无限子弹等最终幸存者
  能力，远超"1/5 随机能力"的设计。
- 修复：`applyLastManKit` 的 last_man 能力改为**不可掉落**
  （`addPerk(perk, false)`）；绝密 AI 能力掉落只保留 1/5 概率的随机能力池。

## 验证
- `extractionSecretLoadoutSmokeTest` 新增断言：绝密 AI 的 last_man 能力
  （endless_ammo 等）`droppable === false`（击杀不掉落）；
- extraction / extraction-secret 冒烟测试 PASS；server `tsc` PASS。
