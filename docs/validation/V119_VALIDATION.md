# V119 验证报告

## 变更范围

- `server/src/utils/systemCpu.ts`：CPU 节流默认关闭；
  `cpuThrottleScale` / `adaptiveBotJoinDelay` 支持 `enabled=false` 直达原值。
- `server/src/gameServer.ts`：CPU 状态机默认恒为 normal；补 AI 不再暂停/变慢；
  工作进程环境新增 `BOT_CPU_LIMIT_ENABLED`。
- `server/src/smartBot.ts`：AI 决策频率不再受 CPU 负载影响（默认）。
- `server/src/cpuLoadControlSmokeTest.ts`：新增 unlimited 模式断言。

## 自动化测试

- server tsc --noEmit：PASS
- test:cpu-load：PASS
  - 启用模式下：soft 节流、hard 暂停、区间有界等原有断言不变；
  - 禁用模式下：`cpuThrottleScale(90,70,80,false) === 1`；
    `adaptiveBotJoinDelay(2000,95,70,80,false)` 返回 `{delayMs:2000, pause:false}`。
- smartBotBrainSmokeTest：PASS

## 运行验证

- 修改后 ts-node watch 已重启 dev server（8001 监听正常）；
- 启动日志输出 `CPU control: disabled (unlimited performance)`。

## 说明

- 需要重新启用时设置 `SURVIV_CPU_LIMIT_ENABLED=1`，
  软/硬阈值仍由 `SURVIV_CPU_SOFT_LIMIT`（默认 70）和
  `SURVIV_CPU_HARD_LIMIT`（默认 80）控制。
