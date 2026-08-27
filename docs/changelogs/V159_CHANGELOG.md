# V159 公告栏（What's New!）恢复最初位置

## 需求

把 What's New! 公告栏放回最初位置（右栏垂直堆叠布局）。

## 实现

### CSS（client/css/app.css）
- 移除此前为「搜打撤 + 公告左右并排」添加的 `#right-column` flex
  规则（display:flex / flex-direction:row / gap 及 news-block、
  news-wrapper 的 flex 修正）；
- `#right-column` 恢复默认 `.menu-column` 块布局，
  `#news-wrapper`（display:block）与 `#news-block`
  （300px + margin-left:30px）回到最初样式；
- 移动端竖屏隐藏右栏的 `#right-column { display: none; }` 保留。

## 验证

- client tsc + vite build：PASS
- 大厅布局：左栏搜打撤面板 / 中央模式按钮 / 右栏 What's New 公告
  （初始垂直位置）。
