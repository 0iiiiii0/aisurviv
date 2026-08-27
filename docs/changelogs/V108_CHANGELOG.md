# V108 无限弹药武器（土豆炮等）不再提示需要弹药

## 问题

- 配装土豆炮（Potato Cannon / Spud Gun）时，仓库提示"未携带 potato_ammo
  弹药"，但这类武器是 `ammoInfinite: true`（无限弹药），不需要携带弹药。

## 修复（client/src/extractionStashUi.ts）

- `loadoutWarnings`：读取武器定义时检查 `ammoInfinite`，
  无限弹药武器跳过弹药检查（不提示未携带/不足）。

## 验证

- client `tsc --noEmit`、`vite build` 通过。
