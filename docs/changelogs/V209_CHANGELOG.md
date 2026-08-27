# V209 撤离使用独立生命周期（不再复制装备/产生死亡副作用）

## 问题

撤离流程先写入仓库再调用普通 `player.kill()`：
死亡流程随后把枪械/背包/护甲全部掉到地面——相同物资既入库又被
其他玩家捡走（复制）；还产生尸体、死亡统计、死亡表情、殉爆等副作用。

## 修复

### server/src/game/objects/player.ts
- 新增 `extractFromMatch()`：独立撤离生命周期——
  标记死亡、移出存活列表、广播撤离 KillMsg（kill feed「已撤离」）、
  转移观战者；**不触发**尸体/掉落/殉爆/死亡统计/死亡表情。

### server/src/game/extractionSystem.ts
- `extract()` 先原子写入仓库（collectCarriedLoot），
  再调用 `extractFromMatch()`，不再走 `kill()`。

## 验证

- 真人玩家站圈 5 秒撤离成功（日志确认）✓
- 撤离后：不在存活列表、**loot 数量不变**（无复制）、
  **无尸体生成** ✓
- server tsc / client build / test:extraction（新增断言）：PASS
