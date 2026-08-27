# V120 崩溃日志统一放到专门的 crash-logs/ 目录

## 需求

- 开一个专门存放崩溃日志的文件夹。

## 实现

- 新建项目根目录 `crash-logs/`，集中存放崩溃日志：
  - `server-crash.log`：devServer 的 JS 异常 / 进程退出码 / 信号记录
    （原 `docs/logs/server-crash.log`）。
  - `launcher.log`：启动器实时输出的服务器/客户端日志
    （含 V8 fatal 等进程级错误 stderr，原 `docs/logs/launcher.log`）。
  - `room-process-events.jsonl`：房间进程崩溃事件
    （原 `game-process-crashes/`）。
- 同步修改写入路径：
  - `server/src/devServer.ts` → `crash-logs/server-crash.log`
  - `start-surviv.ps1` → `crash-logs\launcher.log`
  - `server/src/game/gameProcessManager.ts` → `crash-logs/`
    （仍支持 `GAME_PROCESS_CRASH_DIR` 环境变量覆盖）
- 旧目录 `game-process-crashes/` 已清空删除，历史文件已迁入新目录。
- 附 `crash-logs/README.md` 说明各日志含义与排查指引。

## 验证

- server `tsc` 通过；启动器 PowerShell 语法校验通过。
