# V71 倍镜视野被对手压制时的对战策略

## 需求

- 指定 AI 在"倍镜（2x/4x/8x/15x）视野被对手压制"时的对战策略。

## 问题

- 高倍镜视野半径很小（8x 约 8–9 单位画面），一旦敌人贴近、或在 bot 接火时
  反复移出窄视野，倍镜反而成了"压制自己视野"的负担：`evaluateGunfireViewportSafety`
  会因目标不在画面内而禁止开火，bot 只能被动挨打。
- 此前 bot 从不主动管理倍镜（不发送 EquipNext/PrevScope），视野完全被动。

## 策略（server/src/bot/scopeSuppressionStrategy.ts + smartBot.ts）

**压制判定**（`decideScopeAction`，纯函数）——当前倍镜等级 >1 且满足任一：
1. 敌人进入近距离（`9 + 等级×2.4`：4x≈19、8x≈28、15x≈45 单位内）；
2. 目标可见但被当前窄视野挡在画面外（off-screen）；
3. 正在接火（近 950ms 内受伤）；
4. 近距离弹道威胁（closestApproach<15 且置信度≥0.5）。

**应对动作**：
- 压制时 → 发送 `EquipPrevScope` 下调一级倍镜，拉宽视野（冷却 1.15s 防抖），
  配合既有 combat 走位/掩体逻辑反制，恢复开火能力；记录
  `scope_suppression_dropped` 事件便于回放分析。
- 压制解除且战斗回到安全远距离（`距离 > 下一级倍镜阈值+8`，并过了 1.6s 恢复
  宽限期）→ 发送 `EquipNextScope` 逐步恢复最高可用倍镜（冷却 1.1s）。
- 1x 无倍镜可降，永不误触发。

**接入点**：`combat()`（主动接战）与 `counterfireFromTrajectory()`（弹道反制）
开头均调用 `manageScopedVision`。

## 测试

- 新增 `test:scope-suppression`（纯函数全分支）：
  - 8x + 近距离敌人 → drop（close-enemy）；
  - 8x + 可见但 off-screen 目标 → drop（off-screen-target）；
  - 8x + 正在受伤 / 近距离弹道威胁 → drop（under-fire）；
  - 1x 永不 drop；
  - 压制解除 + 远距离 + 过了宽限期 → raise（safe-long-range）；
  - 宽限期内 / 距离不够 → 不恢复；
  - 冷却期内（lastScopeSwitchAt）→ 保持现状；
  - 源码断言：`decideScopeAction` 接线、EquipPrev/NextScope、combat 与
    counterfire 两处调用、录制事件。
- `test:combat-readiness`、`test:movement-jitter`、`test:cooperation`、
  `test:v41-suite`（11 项）及 V53–V70 全部回归 PASS。

## 实测（main、12 bot、180s）

- 无回归；`weapon-search` 意图在 solo 模式出现（V70 效果）27 次。
- 本次对局唯一持 4x 的 bot（45 帧）全程在搜刮、无敌人、无受伤——策略未触发
  （符合预期，无误降倍镜）；"持倍镜遇近敌"场景为随机遭遇，决策逻辑已由
  确定性单测全覆盖。