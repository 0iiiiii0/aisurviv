# V105 仓库配装携带物不超过背包容量

## 需求

- 仓库配装中携带的子弹/药品/投掷物不得超过当前背包容量上限。
- 更换更小背包或移除背包时，把超限部分放回仓库并告知玩家。

## 实现

### 客户端（client/src/extractionStashUi.ts）
- 新增 `backpackLevel()` / `carryCapacity()`：按配装背包等级计算各类
  携带物上限（与服务端 grant 口径一致，无条目回退 120）。
- 新增 `clampCarriedToBackpack()`：弹药/药品/投掷物超限部分自动放回，
  返回提示文案。
- `setCarry` / `adjustCarry`：目标值同时受"仓库总量 + 背包容量"双重限制。
- `toggleEquip` / `unequip`：更换或移除背包后立即收紧超限携带物，
  并提示"背包容量不足，已放回仓库：XX 放回 N（上限 M）…"。
- `loadStash`：旧版超限数据加载时自动收紧并保存（自愈），同样给出提示。

### 服务端（server/src/stash/stashManager.ts）
- `setLoadout`：保存时按配装背包等级把弹药/药品/投掷物收紧到容量上限
  （与服务端发放口径一致），避免保存超限数据。
- `grantLoadout` 原有的发放容量限制保持不变。

## 验证

- `test:extraction` 通过（新增：保存时按背包容量收紧、
  移除背包后回到 level-0 上限）。
- `test:admin`、`test:loot-capacity` 通过。
- 手动验证：无背包 9mm→120 / bandage→5 / frag→3；
  backpack01→240/10/6；backpack03→420/30/12；换小背包/移除背包
  均自动放回并提示。
- client / server `tsc`、client `vite build` 通过。
