# V97 减速加强：世界时间缩放到 10%

## 需求

- 进一步加强斯安威斯坦的减速效果，从 35% 提升到 10%
  （激活后世界以 10% 速度运行，AI/子弹/毒圈几乎凝固，施法者全速）。

## 实现

- `shared/gameConfig.ts`：`GameConfig.player.sandevistan.worldTimeScale`
  `0.35` → `0.1`（worldDt = realDt × 0.1）。
- `server/src/sandevistanSmokeTest.ts`：断言与日志更新为 0.1。

## 说明

- 减速由服务器权威执行：激活期间施法者按真实时钟移动/射击/换弹，
  其余玩家（AI）、子弹、投掷物、毒圈、空投按 10% 推进；
  结束后世界恢复全速。
- 数值集中在 GameConfig，可随时调整。

## 测试

- server / client 构建通过；
- `test:sandevistan`、`test:v41-suite`（11 项）全部 PASS。