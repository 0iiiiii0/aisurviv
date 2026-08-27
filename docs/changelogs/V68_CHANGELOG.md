# V68 AI movement jitter smoothing

## 现象

- 用 100ms 采样的 AI 对局录制逐帧统计移动方向变化，发现方向变化是"二元的"：
  要么不变（0°），要么直接翻转 90–180°（左↔右 / 上↔下 / 对角线↔反对角线）。
- 各状态翻转率（相邻 100ms 采样出现 ≥90° 方向变化）：
  loot 17.9%、break-crate 21.8%、gas 31.7%、heal 32.4%、combat 28.7%。

## 根因

1. `stabilizeMovementDirection` 只在锁定窗口内"硬性压住整轴翻转"，锁定期一过
   直接快照到目标方向；目标方向在键盘标志边界附近来回摆动时，bot 每隔几百毫秒
   就会在相反方向间来回切换，产生可见的左右抖动。
2. gas/airdrop/retreat/unstuck 走 `allowImmediate` 完全快照路径，其中 gas 的
   方向又叠加了 `teammateSeparation` 等每帧变化的分量，导致逃生时反复折返。

## 修复（server/src/bot/movementInput.ts + smartBot.ts）

- 重写 `stabilizeMovementDirection`：
  - **滞回死区**：目标方向与当前方向夹角 ≤ 0.18 rad（约 10°）时直接采纳，不
    再逐帧在标志边界微摆。
  - **有界角速度旋转**：方向需要改变时，按 `turnRateRadiansPerSecond` 以真实
    帧间隔（`elapsedMs`）平滑旋转，而不是快照；锁定期结束仍朝目标继续转
    （新开一个 hold），从机制上消除"到期瞬间翻转"。
  - 紧急移动（airstrike/retreat/unstuck）仍立即快照，逃生不滞后。
- `moveDirection` 按状态配置转向速度：combat/counterfire 11 rad/s（保持走位灵
  活）、gas 8 rad/s、heal/revive 4.5、special 4、默认 3.5、loot/break-crate 3、
  explore 2.6——搜索/拾取/开箱时转弯肉眼可见地平滑。
- gas 从 `allowImmediate` 名单移除：改为 8 rad/s 高速平滑，抵消每帧分离/导航
  分量带来的折返，同时不牺牲逃命速度。

## 实测（同一 main 图、8 bot、120s、100ms 采样）

| 状态 | 修复前 ≥90° 翻转 | 修复后 |
| --- | --- | --- |
| loot | 17.9% | 1.8% |
| break-crate | 21.8% | 1.8% |
| gas | 31.7% | 13.6% |
| heal | 32.4% | 7.0% |
| combat | 28.7% | 23.9%（小样本，含合法走位） |
| 整体 | ~18–32% | ~4–5% |

## 测试

- 新增 `test:movement-jitter`：
  - 微抖动（≤0.1 rad）不改变键盘标志；
  - 锁定期内 180° 翻转平滑旋转、不快照；
  - 持续翻转在限定时间内完成（真实 30ms tick）；
  - 锁到期继续旋转、不快照（新 hold 开始）；
  - 紧急移动仍立即快照；
  - 左右交替的振荡目标不会把 bot 拖入完整翻转（幅度有界）。
- `test:v22-resource-combat`、`test:bot-input`、`test:v41-suite`（11 项）及
  V53–V67 相关回归全部 PASS；客户端构建 PASS。