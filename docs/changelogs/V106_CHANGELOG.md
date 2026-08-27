# V106 修复仓库示例人物更新失败（Cannot read properties of undefined 'type'）

## 问题

- 仓库页（/storage）示例人物报错：`Cannot read properties of undefined (reading 'type')`。

## 根因

- 武器槽改成固定 2 槽位（空槽为空串）后，示例人物预览仍按旧的"紧凑数组"
  取最后一项：`guns[guns.length - 1]` 取到的是 2 号位的空串 `""`。
- `"" ?? melee ?? "fists"` 不会回退（`""` 不是 null/undefined），于是
  `activeWeapon` 传了空串；渲染管线 `GameObjectDefs[""].type` 直接抛错。

## 修复

- `client/src/storage.ts`（`syncPreview`）：改为优先取 1 号位（主武器），
  空槽回退 2 号位，全部为空回退近战/拳头；并用 `||` 让空串正确回退。
  双枪形态（`_dual`）直接透传给渲染管线（其为完整枪械定义，可正常渲染）。
- `client/src/storagePlayer.ts`（回退渲染）：同样改为 `guns[0] || guns[1]`。
- `client/src/ui/opponentDisplay.ts`（防御）：`activeWeapon` 为空时回退
  近战/拳头，杜绝空武器进入渲染管线。

## 验证

- 场景：`["ak47",""]`、`["","m9"]`、`["m9_dual",""]`、`["",""]` 均正确
  选出主武器/回退。
- client `tsc --noEmit`、`vite build` 通过。
