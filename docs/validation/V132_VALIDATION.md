# V132 验证记录：Host closed the connection 修复

## 复现与定位
- 用户反馈：对局开始约 10 秒内出现 "Host closed the connection"，几乎每场必现。
- 服务端日志证据：`%TEMP%\surviv-dev-logs\server.log`
  - 11:11–11:14 出现 9 次实例重启、27 行 `Restarting 'src/devServer.ts'`、
    1 次 `Failed running`；
  - 每次重启都发生在带 AI 录像的对局开始后数秒内；
  - 11:12:06/11:12:15/11:12:28/11:12:37 录像文件写入时间与重启时间吻合。
- watch 范围实验（同参数临时 watcher）：
  - 写 `server/__watchtest__.txt` → 触发重启
  - 写 `server/ai-match-recordings/__watchtest__.txt` → 触发重启
  - 写 `server/src/__watchtest__.ts` → 触发重启（预期）
  - 写 `shared/__watchtest__.ts` → 触发重启（预期）
  - 写项目根 / workspace 根 → 不触发
  - 结论：`node --watch` 实际监视整个 server/ 目录树。

## 修复后验证（headless Edge + CDP 真实对局）
| 检查项 | 结果 |
|---|---|
| POST /api/find_game | 成功 |
| ws://localhost:8001/play 连接 | 建立并保持 |
| AI 加入对局（normal/hard/pro） | 正常，有击杀/淘汰日志 |
| 录像写入位置 | 项目根 ai-match-recordings/（非 server/） |
| 对局 40+ 秒内 Restarting 次数 | **0** |
| 对局 40+ 秒内 Failed running 次数 | **0** |
| 连接断开 | 无 |
| 客户端异常 | 无 |

## 回归
- server tsc：PASS
- test:sandevistan：PASS（V131 语义未受影响）
- client build（tsc + vite）：PASS
- dev 环境：8001 / 3000 单实例稳定运行，无重启循环。

## 结论
- 根因：AI 对局录像每 750ms 写入 server/ 触发 node --watch 重启；
- 修复：录像/进程日志输出目录移至 watch 树之外；
- 已交付，玩家可直接进对局复测。