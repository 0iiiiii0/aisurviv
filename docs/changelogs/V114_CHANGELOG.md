# V114 修复确认配装后进局没有装备（仓库身份与入局身份不一致）

## 问题

- 在 /storage 确认配装后开始搜打撤对局，进局没有自己的装备。

## 根因

- 进局发放按"对局加入的名字"查找仓库配装
  （`stashManager.grantLoadout(player.name)`），
  但仓库页可能用另一个身份保存配装（例如大厅名字为空时回退到旧 cookie，
  或玩家在仓库页输入了与大厅不同的名字）。
- 名字不一致时 `grantLoadout` 找到的是空配装 → 返回 null → 不进装备。
- 另外服务端对空名/违规名统一改为 "Player"（player.ts），
  进一步加剧名字不一致。

## 修复

### 客户端（client/src/storage.ts）
- "确认配装"按钮现在把当前配装**保存到对局将使用的身份**：
  优先大厅 playerName；大厅名字为空时保存到 "Player"
  （与服务端改名规则一致），保证进局能按该名字发放。
- 保存完成（等 `persistLoadout` 落盘）后再返回主菜单，避免导航中断保存。
- `client/src/extractionStashUi.ts`：新增 `setCurrentName()` 供外部切换身份。

### 测试（server/src/extractionSmokeTest.ts）
- 游戏集成部分使用全局 stashManager（真实 survivio-stash.json），
  现改为测试前后备份/恢复，避免污染玩家仓库数据。

## 验证

- 服务端发放链路用真实数据复现通过：
  player "0.0" 加入搜打撤 → 获得 glock_dual + an94 + 护甲 + 弹药/药品。
- `test:extraction`、`test:admin`、`test:all-modes`、`test:duel` 通过。
- client `tsc`、`vite build` 通过。
