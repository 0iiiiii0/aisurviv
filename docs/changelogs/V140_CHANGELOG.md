# V140 1v1 观战码加入观战删除 + 真人加入后隐藏 AI 选项

## 需求
1. 删除 1v1 大厅里的「观战码加入观战」功能（输入八位观战码进入观战）；
2. 已有真人玩家加入后，不再显示 AI 相关选择框（AI 对手、AI 难度）。

## 实现

### 1. 删除 1v1 观战码加入
- `client/index.html`：
  - 入口表单删除「观战正在进行的本局」区块（观战码输入框 + 进入观战按钮）；
  - 房间邀请栏删除「复制本局观战链接」按钮。
- `client/src/ui/duelLobby.ts`：
  - 删除 `watchInput`、`duelWatch` 链接参数处理、观战按钮/输入框事件绑定、
    `watch()` 方法、`watchUrl()`、`#duel-lobby-copy-watch` 渲染逻辑；
  - 对局中状态文案不再显示观战码（改为「对局进行中」）；
  - 保留 `duelWatch` URL 参数的清理（避免旧链接残留参数）。
- 说明：全局「观战大厅」功能（列出房间观看）不受影响；服务端 1v1
  watch 接口保留（无 UI 入口，不影响其它调用方）。

### 2. 真人加入后隐藏 AI 选项
- `client/index.html`：AI 对手/AI 难度两个 label 增加
  `duel-lobby-ai-toggle-field` / `duel-lobby-ai-difficulty-field` id；
- `client/src/ui/duelLobby.ts`：渲染时检测是否已有真人对手加入
  （`players.some(p => !p.ai && !p.self)`），为真则隐藏两个 AI 选项；
- 服务端原本就拒绝「已有真人后再开启 AI」（updateLoadout 校验），
  UI 隐藏后不会出现可点但无效的控件。

## 验证（headless Edge 实测）
- 1v1 入口：观战码输入框/进入观战按钮/复制观战按钮 全部不存在 ✅
- 房主单独在大厅：AI 对手、AI 难度 可见 ✅
- API 加入真人对手后：AI 对手、AI 难度 自动隐藏 ✅
- client build（tsc + vite）PASS ✅
- 开发环境 8001/3000 正常 ✅