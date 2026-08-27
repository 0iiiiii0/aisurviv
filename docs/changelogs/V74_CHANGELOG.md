# V74 视野内倒地敌人补刀（无直接威胁时）

## 需求

- AI 在视野内看到倒地敌人、且当前没有直接威胁时，应补刀击杀，
  防止其被队友救起或自救（self-revive）。

## 现状与问题

- 目标评分对倒地敌人施加重罚（本地 -45，模式层 solo -34 / duo-squad -18 /
  faction -8），只有 faction 自救医疗兵例外（+210）。
- 结果：只要视野里还有任何站立敌人（哪怕是远处、不构成威胁的），AI 就
  无视倒地敌人，倒地的敌方很容易被救起/自救。

## 实现

### 直接威胁判定（server/src/smartBot.ts `chooseEnemy`）
- 新增 `directThreatActive` 预扫描：当前视野内是否存在**可见、站立**且满足
  以下任一条件的敌人：
  - 距离 < 42 且在瞄准 AI（朝向点积 > 0.45）；
  - 距离 < 14（贴脸）；
  - 是最近弹道威胁的来源（置信度 ≥ 0.5）。

### 补刀评分（smartBot.ts + modeStrategy.ts）
- 无直接威胁时：
  - 本地 `downedPenalty` 由 -45 反转为 **-20（+20 奖励）**；
  - 模式层 `targetScoreModifier` 的 downed 分支改走
    `finishDowned ? +22 : 原罚分`；
  - 视野内近距离倒地敌人会压过远处站立敌人，AI 优先补刀。
- 有直接威胁时：维持原罚分（-45 与模式层罚分），先打威胁。
- `ModeTargetContext` 新增可选 `finishDowned`。

## 测试

- 新增 `test:downed-finish`：
  - `targetScoreModifier`：solo/faction 下 `finishDowned:true` 得分显著高于
    `finishDowned:false`（补刀优先于无视），且为正值；
  - 源码断言：`directThreatActive` 预扫描、条件化 `downedPenalty`
    （`45 : -20`）、`finishDowned` 传入模式层、模式层 +22 分支。
- `test:v41-suite`（11 项）及 V53–V73 全部回归 PASS。

## 实测（main、14 bot、240s）

- 无回归；本局纯 AI 对战中倒地敌人几乎未出现在视野内（nearby downed 帧为 0），
  补刀决策已由确定性单测全覆盖。