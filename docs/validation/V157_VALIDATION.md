# V157 验证记录：搜打撤改动不影响其他模式

## 静态隔离检查

1. MatchTime 广播：仅 `started && extractionMode` 时每秒发送，
   其他模式不产生任何新消息 ✓
2. 毒圈跳过：仅 extraction 模式跳过 `gas.update()`，
   普通/阵营/靶场模式毒圈逻辑不变 ✓
3. AI 补员：`tickExtractionReplenish` 先检查
   `extractionMode`，其他房间直接跳过；`over` 检查仅用于结束后的房间 ✓
4. 胜利判定：`handleGameEnd` 的 extraction 分支位于组队/单人/阵营
   胜利分支之前且仅对 extraction 生效；aim_training 与普通模式原逻辑不变 ✓
5. `GameData.over`：可选字段，仅后台读取，不影响现有构造点 ✓
6. 客户端：`#ui-match-timer` 默认 `display:none`，仅 extraction 模式显示；
   MatchTime 消息其他模式收不到；2:30 提醒在 extraction 分支内 ✓

## 回归测试

| 测试 | 覆盖 | 结果 |
|---|---|---|
| test:all-modes | 50 播放列表 / 18 地图（solo/duo/squad/faction/duel） | PASS |
| test:faction-autofill | 50v50 自动补员 | PASS |
| test:duel / test:duel-lobby | 1v1 对战与大厅 | PASS |
| test:sandevistan | 2077 斯安威斯坦模式 | PASS |
| test:aim-training | 靶场 | PASS |
| test:mode-isolation | 模式隔离 | PASS |
| test:gas-escape | 毒圈寻路（普通模式毒圈） | PASS |
| test:all-downed-elimination | 50v50 倒地/结束判定 | PASS |
| test:cooperation | 50v50 合作指令 | PASS |
| test:extraction | 搜打撤（solo/duo/squad + 新断言） | PASS |

## 结论

- 本轮搜打撤改动（倒计时、2:30 提醒、不弹胜利、补员、GameData.over）
  全部限定在 `extractionMode` 分支内；
- 普通模式、50v50、1v1、2077、靶场的行为与协议均不受影响。
