# V100 修复：仓库/配装客户端交互问题（5 项）

## 问题

1. 同一个 Game 实例跨局复用时，倒计时、撤离读条和 2:30 提醒状态没有在 init/free 重置，
   导致上一局的剩余时间/撤离进度残留到下一局。
2. 仓库切换昵称时旧请求未取消：快速切换会出现“显示 A 的物品、保存到 B”的竞态。
3. 快速点击会并发提交完整配装，旧请求可能覆盖新配装（无 revision / 保存队列）。
4. 双枪 UI 实际无法选择第二把同型枪：已装备一把后再次左键点击会直接卸下而不是合成双枪。
5. 双枪名称仍包含乱码及损坏的 `</div>`（`锛堝弻鏋?/div>`），导致装备槽 HTML 损坏。

## 修复（client/src/game.ts + client/src/extractionStashUi.ts）

1. `Game.init()` 统一重置 `matchStartedTime / extractionPointIndex /
   extractionHoldServer / extractionHoldClient / matchTimeReminderShown`。
2. `loadStash()` 增加模块级请求序号 `stashLoadSeq`：发起前自增并捕获局部值，
   响应（成功或失败）返回时若序号已过期则直接丢弃，防止旧昵称数据覆盖新昵称。
3. `persistLoadout()` 改为经 `saveQueue` Promise 链串行化保存（`runPersistLoadout`
   在真正执行时读取最新 `currentLoadout`），快速点击时最后一次保存始终携带最新配装。
4. `toggleEquip()`：已装备一把时再次点击改为合成双枪（另一槽位若为其它枪则替换）；
   双枪时点击卸下一把变单枪。
5. 修复双枪槽位名称乱码 `锛堝弻鏋?/div>` → `（双枪）</div>`，并顺手修复
   副武器槽空位文案乱码 → `副武器槽`。
6. 核查确认右键近战已正确走 `unequip()`（卸下近战、不删除仓库物品），无残留分支。

## 测试

- client `tsc --noEmit` 通过。
- client `vite build` 通过。
