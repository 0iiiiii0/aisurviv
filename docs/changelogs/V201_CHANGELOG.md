# V201 携带栏位分组（弹药 / 药品 / 投掷物）

## 需求

左栏「携带」区域分成弹药、药品、投掷物三个独立栏位。

## 实现

### client/storage.html + public/css/storage.css
- 「携带」下新增三个小标题栏位：
  - 弹药（#stash-ammo-list）
  - 药品（#stash-heal-list）
  - 投掷物（#stash-throw-list）
- 新增 `.stash-stat-subtitle` 小标题样式（11px 弱化色），
  与「装备」/「携带」主标题区分。

## 验证

- client tsc + vite build：PASS
- 携带区三类物资分组显示
