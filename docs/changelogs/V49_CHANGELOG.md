# V49 Replay/Faction/Admin Fixes

## 已修复

- 50v50 小地图队友状态按 playerId 确定顺序序列化，避免多 worker 异步加入导致状态错位。
- 后台人数和 AI 上限输入框允许先清空再输入，不再自动插入 0 或旧数字。
- AI 搜刮阶段只选择真正能产生可拾取物品的障碍物。
- 树木、石头、窗户等无掉落障碍物仍保留路径破障和战斗破坏能力。
- 真人弹药请求保留首次观察时间，重复表情不会重置响应阶段。
- 真人弹药请求优先处理，取消任意捐赠者取模限制。
- 真人请求时捐赠者可在保留半个弹匣的前提下分享；AI 间常规分享仍保留完整弹匣。
- 增加 V49 录像驱动回归测试。

## 修改文件

- `server/src/game/gameModeManager.ts`
- `server/src/bot/lootStrategy.ts`
- `server/src/bot/factionStrategy.ts`
- `server/src/bot/integratedLogicSpec.ts`
- `server/src/smartBot.ts`
- `client/public/admin/admin.js`
- `client/public/admin/adminInputHelpers.js`
- `client/public/admin/index.html`
- 对应测试及已构建后台静态文件
