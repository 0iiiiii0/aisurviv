# V137 修复：1v1 开局 AI 空袭齐射不执行（录像分析定位）

## 现象（用户反馈）
- 配置足够信标后，1v1 中 AI 依然没有执行地毯式轰炸；
- 要求：详细看录像定位原因。

## 录像分析（2026-08-02T05-10-51-885Z，1v1 legit AI，10 信标）
- `airstrike_counter_armed` 触发 5 次（count=10、barrageCount=3、openingBarrage=true），
  但整场只有 **1 次 `throw_released`（strobe）**，且发生在 58 秒后；
- 开局 2.2 秒内 AI 处于 combat 状态（可投掷窗口），却没有任何
  `special_action_queued`；
- 13:10:54 起玩家空袭落地，AI 进入 airstrike 躲避循环，13:10:58 被炸死；
- 帧数据显示：开局敌人不可见（`target=null`、environment 无敌方玩家），
  双方出生点相距 ~105 码，远超信标 14~40 码投掷包络。

## 根因
- `planForbiddenStrobeCarpet` 的"避免浪费信标"检查：
  `distance(landingPoint, predictedCenter) > coverageRadius + reachableRadius + 5`
  → 敌人距离过远时**直接返回 null**（最近可达落点也够不到敌人）；
- 开局敌人 100+ 码 → 计划永远失败（每 24ms 重试同样失败）→ 齐射只武装不投掷；
- AI 步行接近的过程中被玩家先手地毯炸死 → 整场看不到 AI 空袭。

## 修复
1. `server/src/bot/forbiddenCombat.ts`
   - `ForbiddenStrobeCarpetInput` 新增 `openingBarrage`；
   - 开局齐射模式跳过"太远不扔"检查——改为朝敌人预测位置投掷
     **最大射程前压弹幕**：连续投掷会在敌人接近路线上形成推进的
     火幕（地毯式轰炸），AI 边接近边压制。
2. `server/src/smartBot.ts`
   - 新增 `forbiddenOpeningBarrage` 持久标志：开局武装后**整轮齐射**
     保持前压模式（避免第 1 发后回退严格模式导致齐射中断）；
   - 武装时记录 `openingBarrage`，规划时使用持久标志。

## 验证
- 新增测试（test:br-strobe）：
  - 敌人 105 码远、`openingBarrage=true` → 规划成功，落点距离 30~41 码、
    方向朝敌侧（前压弹幕）；
  - 同场景不带 `openingBarrage` → 仍返回 null（普通模式不浪费信标）；
- 回归：server tsc、test:forbidden-ai、test:duel、test:br-strobe 全部 PASS。

## 效果预期
- 1v1 开局（回合前 4 秒、信标 ≥3）：AI 立即连续投掷 3 个信标向前推进，
  第一发在 ~2.5 秒后落地——即使敌人还在出生点方向，也会被持续前压的
  空袭火幕覆盖。