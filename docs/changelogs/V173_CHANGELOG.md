# V173 直接输入携带数量

## 需求

除了左键/右键按步长调整外，可直接输入要携带的数量。

## 实现

### client/src/extractionStashUi.ts
- 弹药 / 药品 / 投掷物卡片新增数字输入框，显示当前携带数量；
- 新增 `setCarry(type, category, count)`：直接设置携带数量，
  范围 0 ~ 仓库总量（超上限截断、0 移除）；
- 输入框 change 或回车生效；点击/右键输入框不会误触发
  加减步长（事件委托排除 input）。

### CSS（storage.css + app.css）
- `.stash-item-input`：小号数字输入框样式。

## 验证

- client tsc + vite build：PASS
- 输入 0 清空携带；输入超过仓库总量自动截断
