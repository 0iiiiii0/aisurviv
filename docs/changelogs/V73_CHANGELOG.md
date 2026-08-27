# V73 观战状态下遮挡物透明对所有视角生效

## 需求

- 观战玩家状态（跟随某个玩家视角）下，遮挡物透明开关也应生效，
  不能只在自由视角下生效。

## 问题

- `client/src/game.ts` 的渲染门控把遮挡物透明限定为：
  `spectating && freeSpectating && specTransparentObstacles`。
- UI 的"遮挡物透明"按钮在观战时本就可用，但只有**自由视角**（free camera）
  才真正把屋顶/墙体半透明（0.42 alpha），跟随玩家视角时点了没效果。

## 修复

- `client/src/game.ts`：门控改为 `spectating && specTransparentObstacles`，
  观战任意目标（含跟随玩家视角）都生效：
  - 跟随玩家：屋顶/墙体按 0.42 半透明，透视被观战者视角遮挡的目标；
  - 自由视角：行为不变；
  - 非观战（自己游玩）：不受影响，仍用玩家自身位置的屋顶淡出逻辑。

## 测试

- `v41SpectatorInteractionSmokeTest` 新增源码断言：
  - `game.ts` 必须包含 `this.spectating && this.uiManager.specTransparentObstacles`
    （观战任意玩家即生效）；
  - 必须**不**再包含 `spectating && freeSpectating && specTransparentObstacles`
    的旧限制。
- 客户端 `npm run build` 通过。
- `test:v41-suite`（11 项）及 V53–V72 全部回归 PASS。

## Files changed

- `client/src/game.ts`
- `server/src/v41SpectatorInteractionSmokeTest.ts`