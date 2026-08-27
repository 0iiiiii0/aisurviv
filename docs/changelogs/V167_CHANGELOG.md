# V167 枪械图标改用后台 1v1 初始装备同款图片

## 需求

仓库/独立页面中枪械图标缺失，改用后台「1v1 初始装备配置」中使用的
同款枪械图片。

## 根因

- 仓库图标映射此前优先使用 `worldImg.sprite`（游戏内分块枪管贴图，
  16px 宽的细长条），显示效果差且部分枪无贴图；
- 后台 1v1 配置实际使用 `lootImg.sprite` → `img/loot/loot-weapon-<id>.svg`
  （圆形掉落图标，文件一直存在）。

## 实现

### client/src/extractionStashUi.ts
- `itemImage()` 对枪械改为**优先使用 `lootImg.sprite`**（后台同款：
  `img/loot/loot-weapon-ak.svg` 等圆形武器图标）；
- 无 `lootImg` 贴图的枪（sks / qbb / aug / m16a1，后台同样无图）
  依次回退 `worldImg` → 通用枪图；
- 弹药继续使用专用图标 `img/emotes/ammo-<口径>.svg`。

## 验证

- 22 把 GUN_CATALOG 枪中 18 把命中专属图标，4 把回退通用图 ✓
- `img/loot/loot-weapon-ak.svg` HTTP 200 ✓
- client tsc + vite build：PASS
