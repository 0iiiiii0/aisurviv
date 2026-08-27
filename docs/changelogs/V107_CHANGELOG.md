# V107 仓库药品/投掷物/弹药按局内背包顺序排列

## 问题

- 仓库左栏"携带"的药品、投掷物（以及弹药）按放入顺序显示，
  右栏仓库格子的药品/投掷物按名称排序，与游戏内背包顺序不一致。

## 实现（client/src/extractionStashUi.ts）

- 新增 `inGameOrderIndex()` / `byInGameOrder()`：以 `GameConfig.bagSizes`
  的键序作为局内背包顺序（弹药 → 投掷物 → 药品，与客户端背包 HUD 一致）。
- `renderLeft` 的携带列表（弹药/药品/投掷物）改为按局内顺序排序。
- `renderRight` 的仓库格子排序改为对弹药/药品/投掷物统一使用局内顺序；
  未收录的类型排到末尾并保持字典序，倍镜仍按倍率从小到大。

## 验证

- 顺序模拟：药品 bandage→healthkit→soda→painkiller；
  投掷物 frag→smoke→strobe→mirv→snowball→potato；
  弹药 9mm→762mm→556mm→12gauge→50AE→308sub→flare→45acp。
- client `tsc --noEmit`、`vite build` 通过。
