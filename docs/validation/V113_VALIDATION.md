# V113 验证报告

## 变更范围

- `start-surviv.ps1`（启动器）：
  - 端口占用自动清理（netstat 定位 + 整树终止）；
  - 退出/关闭窗口时整树清理（taskkill /T 为主，CIM/Stop-Process 兜底）；
  - `PowerShell.Exiting` 兜底事件 + pid 文件；
  - PS 5.1 下外部命令 stderr 与 `$ErrorActionPreference` 冲突修复。

## 实测（Windows PowerShell 5.1）

| 检查点 | 结果 |
| --- | --- |
| 脚本语法 | ✅ OK |
| `Get-PortOwnerPids`（3000→41748, 8001→42364, 空闲→空） | ✅ |
| 端口被占用时启动 → 自动清理 → 正常启动 | ✅ |
| `-ExitAfterReady` 完整自检 | ✅ exit 0 |
| 启动器退出后 8001 监听 | ✅ 已释放 |
| 启动器退出后 3000 监听 | ✅ 已释放 |
| `%TEMP%\surviv-launcher-pids-*.txt` 残留 | ✅ 无 |

## 结论

- 启动器现在可以反复打开/关闭：关闭时清理自身进程树，关闭后端口不再被
  占用；即便有历史残留进程，下次启动也会自动清理而不是报错卡死。
