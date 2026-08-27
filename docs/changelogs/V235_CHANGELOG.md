# V235 搜打撤仓库支持收集与携带能力（Perk）

## 需求
- 搜打撤仓库可以收集能力（perk，如无限子弹 endless_ammo），并能携带进局；
- 先不关心能力来源，只做"仓库存取 + 携带进局生效 + 撤离回收"。

## 实现

### 服务端（server/src）
- `stash/stashManager.ts`：
  - 仓库新增 `perks` 类别（`stashCategoryFor` 支持 `perk` 类型）；
  - 配装新增 `loadout.perks: string[]`（去重、只保留有效 perk、最多 4 个）；
  - `grantLoadout`：携带的 perk 每个从仓库扣 1，随 `GrantedLoadout.perks` 发放；
  - `collectCarriedLoot`：撤离时把携带的 perk 收回仓库；
  - `recoverPendingGrants`：崩溃恢复归还已扣 perk；
  - `setLoadout` 规范化保存 perk 列表；
- `game/objects/player.ts`：新增 `broughtInPerks`（进局携带的能力），
  `applyExtractionLoadout` 应用 perks（`addPerk`，可掉落）；
- `game/extractionSystem.ts`：撤离时回收携带的 perk。

### 客户端（client/src + storage.html）
- 仓库界面新增「**能力**」类别：
  - 右栏显示仓库中收集的能力（图标 + 名称 + 数量）；
  - 左键携带 / 右键放回（每类最多 1 个，总共最多 4 个）；
  - 左栏「携带」区显示已携带的能力；
- `itemImage` / `itemName` 支持 perk 图标与中文名；
- 携带的能力进局自动生效（如无限子弹），撤离时自动回收。

### 后台（client/public/admin）
- 仓库管理新增「能力」类别，含全体玩家批量添加；
- 建议列表加入常用 perk（endless_ammo / ap_rounds / steelskin / self_revive 等）；
- perk 图标映射（loot-perk-*.svg）已补齐。

## 验证
- `test:stash-all-players`：perk 入库 / 携带 / 进局发放扣仓 / 撤离回收全链路；
- `test:extraction`、`test:admin`：PASS；
- server / client `tsc` + build：PASS。
