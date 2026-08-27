# V118 服务器连续崩溃排查 + 崩溃日志落盘 + 内存压力缓解

## 排查结论

- 连续两次崩溃**都不是 JS 异常**：`docs/logs/server-crash.log` 当天无新记录
  （devServer 的 uncaughtException/unhandledRejection 处理器没有触发）。
- 崩溃绕过了 JS 处理器，属于**进程级致命错误**——结合此前"高负载下出现
  `Fatal process out of memory: Zone`"的历史，最可能是 **V8 内存致命错误
  （Zone OOM）**，由搜打撤对局的高内存压力触发：
  - 搜打撤补员此前**每个 AI 单独 spawn 一个子进程**（`botCount: 1`），
    一场 20 人的对局会常驻约 19 个子进程，且阵亡后反复补充，进程/内存
    压力大。
  - 开发模式下所有对局都在 devServer 进程内运行，主进程 + 大量 bot
    子进程共同挤压内存。
- 崩溃时启动器只把日志滚到控制台、不落盘，导致 V8 fatal 的具体输出无法
  事后查看。

## 修复

### 1. 崩溃日志落盘（start-surviv.ps1）
- 启动器把服务器/客户端实时输出同时写入 `docs/logs/launcher.log`。
- V8 fatal 等进程级错误（绕过 JS 处理器）的 stderr 输出也会被保存，
  下次崩溃可精确定位原因。

### 2. 进程退出原因记录（server/src/devServer.ts）
- 增加 `SIGINT/SIGTERM/SIGHUP` 与 `process.on("exit")` 记录：
  区分"JS 异常退出"与"进程被信号/致命错误杀掉"。

### 3. 降低搜打撤内存压力（server/src/gameServer.ts）
- 搜打撤补员改为**每批 3 个 AI 共用一个子进程**（原为 1 个 AI 一个进程），
  常驻 bot 子进程数约降为原来的 1/3，缓解 V8 Zone OOM。

## 验证

- `test:extraction`、`test:admin` 通过；server `tsc` 通过。
- 启动器 PowerShell 语法校验通过。
