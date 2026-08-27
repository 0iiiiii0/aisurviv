# V251 修复商店与绝密搜打撤问题

## 修复

### 1. 绝密补员 AI 与房间规则不一致（核心）
- 问题：搜打撤补员（`spawnReplacementExtractionBot`）判断"是否绝密"用的是
  **主进程实时 `Config.extractionSecret.enabled`**，而房间内
  `extractionSecretEnabled` 用的是**建房间时的快照**。后台在对局进行中切换
  绝密开关后，补员 AI 的难度/配装会与房间实际规则不一致（例如补进来的 AI
  用了绝密配装却没套最终幸存者能力、撤离点锁定等规则也不匹配）。
- 修复：`Game.extractionSecretEnabled` 由方法改为 getter，并同步进
  `GameData`（`updateData` / `GameProcess` 同步）；补员逻辑改用
  **`game.extractionSecretEnabled`（房间快照）**，与房间内规则严格一致。

### 2. 商店买卖非原子（崩溃可能不一致）
- 问题：`shopBuy` = `addItem` + `removeCoins`、`shopSell` = `removeItem` +
  `addCoins` 是多次独立加锁写操作；进程中途崩溃可能出现"扣了仓没给钱"或
  "给了钱没入仓"。
- 修复：`StashManager` 新增 `atomicTrade`（单次加锁写事务内 扣仓/加仓/金币
  变动，任一步失败整体不生效）；`shopBuy` / `shopSell` 改用原子交易。

## 验证
- 商店 / 绝密 / 绝密配装 / 加入窗口 / 搜打撤 / 重连 冒烟测试全部 PASS；
- server `tsc` PASS。
