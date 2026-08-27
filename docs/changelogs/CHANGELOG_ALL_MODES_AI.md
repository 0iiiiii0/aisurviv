# 全模式 AI 修改清单

## 新增

- `server/src/bot/modeStrategy.ts`
- `server/src/allModesSmokeTest.ts`
- `MODE_PROFILES_ALL_MODES.json`
- `ALL_MODES_AI.md`
- `VALIDATION_ALL_MODES_AI.txt`

## 修改

- `server/src/smartBot.ts`
  - 自动识别播放列表的队伍模式。
  - 接入模式化索敌、武器、物资、箱子、弹药、毒圈、进攻、撤退、编队和救援权重。
  - 未显式设置 `BOT_TEAM_SIZE` 时，从 `BOT_GAME_MODE` 自动推断 1/2/4 人。

- `server/src/gameServer.ts`
  - 后台“加入 AI”扩展到所有地图和队伍模式。
  - 自动传递地图、模式索引、队伍大小、阵营和 Duel 配置。

- `server/src/game/gameManager.ts`
- `server/src/game/gameProcessManager.ts`
  - 加入令牌支持指定人数和自动补队参数。

- `server/package.json`
  - 新增 `test:all-modes`。
