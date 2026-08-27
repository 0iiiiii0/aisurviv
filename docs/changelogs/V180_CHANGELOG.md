# V180 角色区缩小，空间让给下方武器/携带区

## 需求

角色展示腾出的位置给下方区域（武器槽 / 携带统计）。

## 实现

### client/src/storagePlayer.ts
- 画布由 320×330 缩小为 **280×230**（角色 62% 适配，更紧凑）。

### client/public/css/storage.css
- `.stash-avatar-wrap` 高度 344px → **240px**；
- `.stash-weapons` min-height 118px → **150px**（利用腾出的空间）；
- `.stash-left-stats` 增加 `flex: 1`，占满剩余高度。

## 验证

- client tsc + vite build：PASS
- 角色展示更小巧，下方武器槽与携带统计区获得更多空间
