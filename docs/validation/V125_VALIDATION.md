# V125 验证报告

## 变更范围

- `server/src/smartBot.ts`：
  - 卡住恢复的容器目标改为碰撞体外侧接近点（`resourceColliderPlan`）；
  - 离开资源状态时清理 resourcePursuit 记录。
- `server/src/navigationRecoverySmokeTest.ts`：新增容器接近点断言。

## 对局实测（自行开始的纯 AI 对局）

两次对局均为：main 地图、单人、8 个 normal AI、约 150 秒，
录制于 `server/ai-match-recordings`：

- 修复前：`2026-08-01T19-57-22-348Z_pid-16000`（game 70bb2c05…）
- 修复后：`2026-08-01T20-05-41-880Z_pid-20372`（game 9596d62c…）

### 关键对比

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| path_recovery（容器） | 15 | 3 |
| path_recovery（loot） | 12 | 20（多为 hide 状态，非搜索阶段） |
| resource_target_abandoned | 65 | 58 |
| 容器恢复目标 | 容器中心（碰撞体内） | 外侧接近点（1.3–1.4u） |

## 自动化测试

- server tsc --noEmit：PASS
- test:navigation-recovery：PASS（含新增容器接近点断言）
- test:loot-strategy / test:movement-jitter：PASS
- test:v52-building-walls / test:integrated-spec / test:v47-regular-replay /
  test:loot-safety：PASS

## 说明

- loot 目标保持使用物体位置（地面物资无碰撞体，直接寻路合理）；
- 近距离“no-distance-progress”放弃保留为逃生机制（目标在墙另一侧时
  及时放弃并进入 backoff），本次只修正真正卡死的容器寻路。
