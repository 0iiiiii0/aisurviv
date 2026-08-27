# V102 仓库武器槽：点击放回 + 拖动交换 1、2 号位

## 需求

1. 武器槽可以点击来把武器放回仓库。
2. 拖动可交换 1、2 号武器的位置。
3. 1 号武器放回仓库后，2 号武器保留在 2 号位（不会前移到 1 号位）。
4. 1、2 号武器位已满时不允许再添加武器。

## 实现

武器槽改为固定位置语义：`guns[0]` = 1 号位、`guns[1]` = 2 号位，空槽用空串
占位；移除 1 号位武器时只清 `guns[0]`，2 号位武器保持在 `guns[1]`。

### 客户端
- `client/src/extractionStashUi.ts`
  - `renderLeft`：武器槽有武器时加 `filled` 状态（可点击/可拖动高亮）。
  - `bindStashEvents`：武器槽点击放回仓库（双枪的副槽占位除外）；
    拖拽 1↔2 号位交换并自动保存；近战槽点击放回近战。
  - `toggleEquip` / `unequip`：改为按槽位写入空串，不再 splice 前移；
    1、2 号位已满时点击新武器提示"武器槽已满，请先放回一把武器"。
- `client/storage.html`：武器槽加提示标题；枪械区说明更新。
- `client/public/css/storage.css`：`.stash-weapon.filled` 悬停高亮、
  `.drag-over` 拖放高亮。

### 服务端
- `server/src/stash/stashManager.ts`
  - `setLoadout`：按槽位保存（空槽补空串，防止序列化成 null）。
  - `getStash` 迁移：旧配装按槽位归一化，保持 2 号位不前移。
  - `grantLoadout`：按槽位发放（weapons[slot] 与 1、2 号位一一对应，
    空槽用 `{ type: "" }` 占位），2 号位武器不会装到 1 号位。
- `server/src/game/objects/player.ts`
  - `applyExtractionLoadout`：先清空主/副武器槽再按槽位装备，
    空槽不残留上一局武器。
- `server/src/extractionLoadouts.ts`：AI 配装也统一为 2 个固定槽位。

## 测试

- `test:extraction` 通过（新增：双枪合成、非双枪去重、仅 2 号位武器
  必须装在副武器槽、空主槽不残留）。
- 手动验证 `setLoadout`/`grantLoadout`：
  `["","groza"]` 保存与发放均保持 2 号位；`["m9","m9"]` 双枪保留；
  `["ak47","ak47","groza"]` 归一为 `["ak47",""]`。
- client / server `tsc`、client `vite build` 通过。
