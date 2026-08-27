# V184 近战武器可入仓、可携带

## 需求

近战武器（指虎/匕首/太刀等）也可以放仓库并携带进局。

## 实现

### 服务端（server/src/stash/stashManager.ts）
- StashData 新增 `melee` 类别（42 种近战均可存放、堆叠）；
- `BringInLoadout` 新增 `melee?: string`（携带一把近战）；
- `setLoadout` 校验并保存 melee；`grantLoadout` 有库存时扣除 1 把
  并返回 `melee`；新手包新增 `knuckles` ×1；
- `collectCarriedLoot` 支持收集撤离时的近战武器。

### 带入（server/src/game/objects/player.ts + extractionSystem.ts）
- `applyExtractionLoadout` 支持 `melee`：进局时装备到
  `WeaponSlot.Melee`（非 fists）；
- 撤离时近战武器自动存入仓库。

### 客户端（extractionStashUi.ts + storage.html）
- 仓库新增「近战」分类（图片 + 数量，点击装备/卸下、右键移除）；
- 左栏武器区新增第 3 槽显示近战武器；
- 装备摘要（/storage 左栏）显示当前近战。

## 验证

- 新手包含 knuckles；katana 可存入、可装备（loadout.melee）✓
- server tsc / client build / test:extraction（新手包断言）：PASS
