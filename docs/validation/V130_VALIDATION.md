# V130 验证记录：主界面模式按钮无响应 / 按钮文字溢出

## 测试环境
- 项目：surviv.io-main-v53-matchmaking-recovery
- dev server：Vite 3000 + GameServer 8001（运行中）
- 浏览器：headless Edge + CDP（remote-debugging-port 9339）

## 验证项与结果

### 1. 按钮点击无反应（主因）
- 修复前：加载主菜单控制台报 `ReferenceError: $ is not defined`
  （`new SpectateLobby()` 在 `tryLoad()` 内实例化时抛出，中断后续绑定）；
- 修复后：
  - 控制台无 `$ is not defined`；
  - 点击 Play Solo 按钮，Network 中出现 `find_game` 请求，成功进入对局；
  - 模式选择相关绑定（`main.ts` 第 230 行 `.quick-play-mode-button` 点击）正常触发。

### 2. 观战功能不受影响
- 观战按钮正常显示；
- 点击后弹出房间列表，共列出 7 个房间（`/api/spectate/rooms` 正常返回）。

### 3. 按钮文字溢出
- 长标签按钮单行显示；
- 超出部分以省略号截断，不再换行溢出/撑破按钮；
- 双列模式按钮网格（aim-training `#mode-button-grid`）同样生效。

### 4. 构建与静态检查
- client TypeScript 编译：PASS
- Vite production build：PASS（产物 app-BAGCIq11.js）

## 结论
- V130 修复通过，可交付；
- 玩家端刷新页面（Ctrl+F5）后生效，无需服务端重启。