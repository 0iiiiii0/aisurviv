# V131 斯安威斯坦减速语义修正：玩家速度=施法者自身动作，对局速度=其他玩家+AI+世界

## 需求
- 后台 2077 卡片中「玩家速度 / 对局速度」两个设置的语义有误，需要修正；
- 正确语义：
  - **玩家速度（playerTimeScale）** = 开启斯安威斯坦的玩家**自身**动作保留比例
    （射击速度、移动速度、打药速度、装弹速度）；
  - **对局速度（worldTimeScale）** = 其他玩家、**AI**、子弹、毒圈、投掷物、
    地图交互的速度。
- 此前「玩家速度」被错误地用于「其他玩家和 AI 保留的时间速度」，且施法者本人
  保持全速，后台文案与行为都不符合需求。

## 实现

### 服务端
1. `server/src/config.ts`
   - `SandevistanConfig` 注释修正：playerTimeScale 改为「施法者自身动作
     （移动/射击/打药/装弹）」，worldTimeScale 改为「整局（其他玩家、AI、子弹、
     毒圈、投掷物、地图交互）」；
   - 默认值：`playerTimeScale: 0.5`（玩家自身动作保留 50%）、
     `worldTimeScale: 0.1`（对局保留 10%），与 `survivio-config.json` 中
     已配置的 0.5 / 0.1 一致；加载时 fallback 同步更新。
2. `server/src/game/game.ts`
   - 注释更新；`playerBarn.update(playerDt, worldDt, dt)` 改为同时传入
     玩家时钟与世界时钟。
3. `server/src/game/objects/player.ts`
   - `playerBarn.update(playerDt, worldDt, realDt)`：
     - 施法者（`sandevistanActive`）→ 按 `playerDt`（= dt × playerTimeScale）
       推进自身动作（移动、射击、打药、装弹全部走 dt，自动生效）；
     - 其他所有人（真人 + AI）→ 按 `worldDt`（= dt × worldTimeScale）推进；
   - `player.update(dt, realDt = dt)`：斯安威斯坦的持续/冷却计时改用 `realDt`，
     保证技能时长始终按真实秒数走，不受玩家自身减速影响；
   - 移除旧的「人类冷却期保持全速」特判——现在其他玩家统一归入对局速度。
4. `server/src/adminServer.ts`：校验错误文案改为「玩家自身时间倍率」。

### 后台 UI（client/public/admin/admin.js）
- 玩家速度说明：**开启斯安威斯坦的玩家自身动作保留（射击、移动、打药、装弹）**；
- 对局速度说明：**其他玩家、AI、子弹、毒圈、投掷物和地图交互速度**；
- 摘要改为：「生效后：你本人动作保留 X%；其他玩家、AI、子弹、毒圈、投掷物和
  地图交互保留 Y%。」；
- 「恢复默认」改为 玩家 50% / 对局 10%。

### 共享配置
- `shared/gameConfig.ts` 注释同步更新（客户端仅用 worldTimeScale 渲染子弹等
  本地模拟，施法者动作由服务端权威推进，无需客户端改动）。

## 默认值
- 玩家速度（自身动作）：50%
- 对局速度（其他玩家 + AI + 世界）：10%
- 后台可随时独立调整并即时生效（对局中每 5 秒同步一次）。