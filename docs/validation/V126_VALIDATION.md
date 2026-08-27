# V126 验证报告

## 变更范围

- `shared/defs/maps/factionDefs.ts`：队长任命 50s → 12s。
- `server/src/smartBot.ts`：
  - 队长信号枪槽位保护（gunPickupPlan + handleGeneralFlare）；
  - 室内门逃生失败升级（封锁全门 + 长边界探测）；
  - `resourceStallSince` 原地拾取冻结检测；
  - `openingLootSeconds` 开局拾取窗口接线。

## 对局实测（server/ai-match-recordings）

- 修复前：`2026-08-01T20-12-58…`（a7ce34f4，队长 50s 任命）
- 修复后：`2026-08-01T20-33-35…`（1bffcac1）、
  `2026-08-01T20-40-57…`（f6a1addc，含全部修复）

### 信号弹

- 队长在 12s 获得信号枪（修复前 50s）；
- 首次信号弹瞄准 23s / 49s（修复前 88s）；
- 首次空投落点 79s / 146s（修复前 119s；地图差异影响走位距离）。

### 室内

- 门逃生：失败 ≥2 次后封锁全部门并走建筑边界 2.6-4.6s，
  不再每 2-3 秒切换一个门；
- 原地拾取冻结：4 秒无移动即触发 `resource_stall_recovered`
  （第 2/3 场各触发 2-3 次，直接打断 120s+ 冻结）；
- 拾取窗口关闭后 loot 在室内滞留中的占比从 0.63 降至 0.58。

## 自动化测试

- server / client tsc：PASS
- vite build：PASS
- 冒烟测试（10 项）：PASS

## 说明

- 各场地图为程序化生成，室内指标受地图布局影响存在波动；
  修复聚焦于可复现的机制性问题（任命时机、丢枪、门循环、拾取冻结、无限拾取）。
