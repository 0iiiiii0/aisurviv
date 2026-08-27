# V169 减小弹药/投掷物/医疗用品图标

## 需求

仓库界面中弹药、投掷物、医疗用品的图片太大，需要减小。

## 实现

### client/src/extractionStashUi.ts
- `renderGrid` 对 弹药（ammo）/ 投掷物（throwables）/ 医疗用品
  （consumables）三类卡片附加 `small` class；
- 枪械、护甲卡片保持原尺寸。

### CSS（storage.css + app.css）
- `.stash-item.small img` 高度由 76px 减至 **38px**；
- `.stash-item.small` 卡片最小高度 78px（紧凑显示）。

## 验证

- dist/css/storage.css 与 dev 3000 均包含 `.stash-item.small` ✓
- client tsc + vite build：PASS
