# V208 修复示例人物更新崩溃（weapons 缺少 type 字段）

## 问题

报错：
`TypeError: Cannot read properties of undefined (reading 'ammoInfinite')`
at `Player.update` —— `curWeap.type` 为 undefined，
`GameObjectDefs[undefined]` 返回 undefined。

## 根因

LoadoutDisplay.init 的 `setLocalData` 传入的 weapons 数组字段名为
`name`，而 `setLocalData` 读取 `data.weapons[i].type`；
type 缺失 → localData.weapons[2].type = undefined → 后续
`itemDef.ammoInfinite` 崩溃。

（此前该崩溃被 getBagLevel 崩溃提前中断掩盖，V194 修复后暴露。）

## 修复（client/src/ui/opponentDisplay.ts）

- `setLocalData` 的 weapons 数组字段 `name` → **`type`**
  （与 setLocalData 读取一致）。

## 验证

- client tsc + vite build：PASS
- 示例人物更新不再抛错
