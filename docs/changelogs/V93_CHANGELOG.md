# V93 斯安威斯坦激活键：改为鼠标中键（可改键）

## 需求

- 按 G 激活与大地图键位冲突，改为鼠标中键激活；
- 允许用户在设置中更改键位。

## 实现

- `client/src/inputBinds.ts`：`GameInput.Sandevistan` 默认绑定从
  `Key.G` 改为 `MouseButton.Middle`（鼠标中键）；G 键回归大地图 fallback。
- 改键能力：设置界面按键列表**动态遍历 BindDefs**（InputBindUi.refresh），
  Sandevistan 条目自动出现，可点击改为任意键/鼠标键（ESC 取消、Backspace 清空）。
- `client/index.html`：技能槽按键提示 [G] → [中键]。

## 测试

- client 构建（vite）通过；server 构建通过；
- `test:sandevistan` 通过。