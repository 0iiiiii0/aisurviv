# V129 验证报告

## 变更范围

- `server/src/game/objects/player.ts`：靶场闪避改为独立状态机
  （承诺方向/承诺期/横向符号），威胁带加宽，重生时重置；
- `server/src/aimTrainingSmokeTest.ts`：新增连射稳定性与不可躲避子弹测试。

## 自动化测试

- server tsc --noEmit：PASS
- test:aim-training：PASS
  - 触发横向闪避；连射 10 颗子弹方向翻转 ≤2（无抽搐）；
  - 不可躲避子弹仍强制移动。
- test:v29-aim-sim / test:movement-jitter / test:combat-readiness /
  test:cooperation：PASS

## 行为对照

| 场景 | 修复前 | 修复后 |
| --- | --- | --- |
| 步枪连射命中 | 每颗子弹翻转左右 → 原地抽搐 | 锁定一侧横移 ≥0.26s，稳定闪避 |
| 无法躲避的子弹 | 可能原地站立 | 仍持续横向移动 |
| 近失子弹（横向 2–4u） | 不触发闪避 | 威胁带内仍保持移动 |
| 靶场边界 | 可能反复撞墙 | 选边时避开边界 |

## 说明

- 只影响瞄准练习的目标 AI，不影响常规对局 AI（原有 combat/forbidden
  闪避逻辑不变）；
- 承诺期按子弹到达时间 1.8 倍缩放，钳制在 260–460ms；
- 目标跨越子弹轨迹线时会翻转一次并重新锁定 300ms，
  连射期间不会逐弹交替。
