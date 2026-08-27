# V130 主界面模式按钮无响应修复 + 按钮文字溢出修复

## 需求
- 主界面点击「选择模式」按钮无反应，无法进入任意模式；
- 模式按钮文字过长时溢出换行，撑破按钮布局。

## 根因（按钮无反应）
- `client/src/ui/spectateLobby.ts` 在类字段初始化器里直接使用了 jQuery
  （`modal = $("#…")`、`overlay = $("#…")` 等），但文件**缺少 `import $ from "jquery"`**；
- 主菜单 `main.ts` 的 `tryLoad()` 会实例化 `new SpectateLobby()`，此时抛出
  `ReferenceError: $ is not defined` 并中断 `tryLoad()` 后续代码；
- 而「模式按钮」的点击绑定 `playButtons.on("click", ".quick-play-mode-button", …)`
  位于 `tryLoad()` 第 230 行，永远没有执行 → 点击模式按钮无任何反应。

## 根因（文字溢出）
- 模式按钮标签较长（如「2077 · 斯安威斯坦」等），`.menu-option` 没有
  `overflow/ellipsis/nowrap` 规则，文字换行后被容器裁切或撑出按钮。

## 实现
1. `client/src/ui/spectateLobby.ts`
   - 文件顶部新增 `import $ from "jquery";`，观战大厅类可正常实例化，
     `tryLoad()` 不再中断，模式按钮点击绑定正常生效。
2. `client/css/app.css` `.menu-option`
   - 新增 `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`，
     长标签单行显示、超出部分省略号截断。
3. `client/css/aim-training.css` `#mode-button-grid`
   - 对网格内 `.menu-option`（含 quick-start / duel-start / extra-mode-buttons）
     同样新增 `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`，
     防止双列网格内按钮文字换行溢出。

## 验证
- `client tsc`：PASS；
- `vite build`：PASS（产物 app-BAGCIq11.js）；
- headless Edge 实测（remote debugging）：
  - 控制台不再出现 `$ is not defined`；
  - 点击 Play Solo 成功发起 `find_game` 请求并进入对局；
  - 观战按钮正常弹出并列出 7 个房间；
  - 长文字按钮单行显示、不再溢出到下一行。

## 备注
- 纯客户端改动，服务端无需重启；线上玩家 **Ctrl+F5 强制刷新** 即可生效。