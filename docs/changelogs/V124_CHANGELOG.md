# V124 修复"游戏无法连接但程序无报错也不重启"

## 现象

- 有时游戏无法连接（连不上对局/请求无响应），但服务器进程没崩、
  没有报错、启动器也不自动重启。

## 根因

- 启动器只做 TCP 端口探测（`Test-Port`）：服务器**事件循环被阻塞
  （挂起）**时端口仍在监听，TCP 能连上 → 启动器认为健康 → 不重启；
  但客户端连接得不到响应 → "无法连接"。
- 事件循环挂起的来源之一是仓库锁的**同步忙等**：`acquireLock` 里
  `while (Date.now() < end) {}` 最长可阻塞事件循环约 15 秒
  （1000 次 × 15ms）；若崩溃残留了锁目录，启动后首次仓库操作就会
  长时间阻塞，期间服务器无法处理任何连接。

## 修复

### 1. 启动器 HTTP 健康检查（start-surviv.ps1）
- 新增 `Test-ApiHealth`：请求 `http://127.0.0.1:8001/api/site_info`，
  3 秒超时。
- 服务器"健康"判定改为：**端口可连 且 API 有响应**。
  端口能连但 API 无响应（挂起）连续 6 次 → 触发自动重启。
- 重启后的就绪判定同样等 API 响应，而非仅端口。
- 修复：`-and` 直接跟在命令调用后会被当成参数（`Test-Port ... -and ...`
  报"找不到参数 and"），已用括号包裹为 `(Test-Port ...) -and (...)`。

### 2. 启动器清理残留锁/临时文件（start-surviv.ps1）
- 启动前删除 `survivio-stash.json.lock` 与 `survivio-stash.json.*.tmp`
  残留，避免崩溃后首次仓库操作进入长忙等。

### 3. 缩短仓库锁忙等（server/src/stash/stashManager.ts）
- `acquireLock` 忙等从 1000×15ms（最长 ~15s）降到 200×10ms（最长 ~2s）；
- 残留锁判定从 15s 降到 5s，更快清除陈旧锁。

## 验证

- `test:extraction`、`test:admin` 通过；server `tsc` 通过；
  启动器 PowerShell 语法校验通过。
