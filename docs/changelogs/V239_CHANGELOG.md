# V239 确认搜打撤双人/四人：无毒圈 + 撤离点 + 倒计时

## 需求
- 确认搜打撤的双人、四人模式与单人一致：没有毒圈，都有撤离点和对局倒计时。

## 结论（已用测试锁定）

机制（server/src/game/game.ts 主循环）：
- **没有毒圈**：`if (!extractionMode) this.gas.update(worldDt)` ——
  搜打撤（任意队伍规格）毒圈不推进，`gas.mode` 恒为 `Inactive`、`stage` 恒为 0，
  全图始终是安全区；
- **撤离点**：`extractionSystem` 按地图生成撤离点（与队伍规格无关），
  每个模式都有；
- **倒计时**：`startedTime` 随对局推进，10 分钟限时
  （`EXTRACTION_MATCH_TIME_LIMIT_SECONDS = 600`），时间到全员淘汰。

## 验证
- 新增 `test:extraction-no-gas`：分别创建 extraction 单人 / 双人 / 四人局——
  撤离点 ≥ 3、推进 30 帧后毒圈仍 `Inactive / stage 0`、`startedTime` 推进、
  限时 600 秒，全部 PASS；
- server `tsc` / build：PASS。
