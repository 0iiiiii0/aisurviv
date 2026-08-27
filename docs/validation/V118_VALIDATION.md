# V118 验证报告

## 变更范围

- `client/public/admin/index.html`：自动刷新默认 5 秒。
- `client/public/admin/admin.js`：无已保存偏好时默认开启自动刷新。

## 复现实测（真人 vs AI 1v1）

用脚本创建 1v1 房间 → 开启 AI 对手 → 开始对局 → 模拟真人 WebSocket 加入，
随后每 500ms 轮询 /admin-api/status 90 秒：

| 阶段 | 真人 | AI |
| --- | --- | --- |
| 建房后 0–3 秒（双方未加入） | 0 | 0 |
| 真人加入后 | 1 | 0（AI 进程约 3 秒内连上） |
| 稳定对战中 | 1 | 1 |
| AI 掉线/对局结束 | 1 | 0（或房间消失） |

- 未出现"双方都在游戏内却显示 0/0"的服务端错误。
- 结论：显示 0/0 的原因 = 页面停留在建房瞬间的旧快照（自动刷新默认关闭）。

## 自动化测试

- admin.js 语法检查：PASS
- vite build：PASS
- dev server 静态资源已生效：PASS
