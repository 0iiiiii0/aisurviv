# V231 修复观战者看不到搜打撤对局剩余时间

## 问题
- 搜打撤（10 分钟限时）对局中，观战者（观战码 / 后台观战）看不到左上角的
  剩余时间倒计时。
- 原因：`client/src/game.ts` 的 `updateExtraction` 开头条件是
  `!extractionMode || !this.playing || this.spectating`，观战者
  `spectating = true`，导致**剩余时间计时器和撤离点 HUD 一起被隐藏**。
- 服务端其实一直会向观战者广播 `MatchTime`（全局广播写入每个玩家的消息流），
  所以观战者的 `matchStartedTime` 有值，只是客户端没显示。

## 实现（client/src/game.ts）
- `updateExtraction` 拆分：
  - **剩余时间倒计时**（`ui-match-timer`）：真人玩家和观战者都显示；
  - **撤离点 HUD**（撤离点标记 / 撤离进度 / 一键撤离）：仅真人玩家显示，
    观战者清空并隐藏；
- 「剩余 2 分 30 秒」提醒只对真人玩家触发（观战者只看到倒计时，不提示撤离）。

## 验证
- client `tsc`：PASS；
- client `vite build`：PASS（`dist` 已更新）；
- 元素 `#ui-match-timer` 已存在于主界面（index.html）。
