# V104 仓库武器改为"按把数装备"：左键加一把，双持最多 4 把

## 需求

- 左键点击仓库武器 = 增加一把（不再"第一把放回"）。
- 双持武器左键 3 下 = 1 号位双持 + 2 号位一个单持；4 下 = 两个双持。
- 非双持武器左键 2 下 = 两把（1、2 号位各一把）。

## 实现

武器槽改为显式槽位内容：每个槽可以是空槽、单枪（"m9"）或双枪形态
（"m9_dual"，占 2 把）。左键点击按顺序加一把：

- 双持武器：1 把→1号位单持；2 把→1号位双持；3 把→1号位双持+2号位单持；
  4 把→两个槽位都双持（最多 4 把）。
- 非双持武器：最多 2 把（1、2 号位各一把）。
- 槽位被其它枪占用时提示"武器槽已满"，不会清空其它槽位
  （例如 `["m9","ak47"]` 再点 m9 → `["m9_dual","ak47"]`，ak47 保留）。
- 右键 = 卸下一把（双持槽先降为单枪，再清空）；点击武器槽 = 整槽放回；
  拖动仍可交换 1、2 号位。

## 修改文件

- `client/src/extractionStashUi.ts`：
  - 新增 `slotBaseOf` / `slotIsDual` / `equippedCopies` / `normalizeGunSlots`。
  - `toggleEquip`：左键 = 加一把；`unequip`：右键 = 卸一把。
  - `renderLeft`：按槽位内容显示单枪/双枪形态；`renderRight` 装备高亮、
    `loadoutWarnings` 弹药按总把数（双持计 2 把）计算。
- `server/src/stash/stashManager.ts`：
  - `setLoadout`：保留 `_dual` 槽位；允许两个单持槽放两把同型枪；
    两把可双持单枪自动合并为 1 号位双持。
  - `getStash` 迁移：按新模型归一化旧配装。
  - `grantLoadout`：双持槽按 2 把扣仓并发放 `_dual` 类型。
- `server/src/game/objects/player.ts`：`applyExtractionLoadout` 按槽位装备
  （显式 `_dual` 直接装备；两把相同可双持单枪仍兼容合并为双持；
  两把相同非双持枪现在合法地各占一个槽位）。
- `client/storage.html`：枪械区操作说明更新。

## 验证

- `test:extraction` 通过（新增：ak47×2 各占一槽、m9_dual+m9、
  m9_dual×2）。
- `test:admin`、`test:loot-capacity` 通过。
- 客户端模拟：ak47 点 1/2/3 下、m9 点 1~5 下、右键卸一把、
  槽满阻止，全部符合预期。
- client / server `tsc`、client `vite build` 通过。
