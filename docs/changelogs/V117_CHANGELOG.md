# V117 仓库新增"一键放回"

## 需求

- 玩家携带的装备（武器/近战/弹药/药品/投掷物/护甲）一键全部放回仓库。

## 实现

- `client/storage.html`：头部新增"一键放回"按钮。
- `client/src/extractionStashUi.ts`：
  - 新增 `resetLoadout()`：把 `currentLoadout` 清空
    （武器槽清空、近战/弹药/药品/投掷物/护甲全清）并保存，
    提示"已把所有携带物品放回仓库"。
  - `bindStashEvents` 绑定按钮点击。
- `client/public/css/storage.css`：按钮样式（与"确认配装"区分）。

## 说明

- 放回是非破坏操作：物品回到仓库，可随时重新配装。
- 空配装进局 `grantLoadout` 返回 null，不会发放任何装备。

## 验证

- 实测：配装清空后 guns=["",""]、弹药/药品/护甲为空，
  `grantLoadout` 返回 null。
- client `tsc`、`vite build` 通过。
