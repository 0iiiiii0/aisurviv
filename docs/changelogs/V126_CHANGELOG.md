# V126 修复搜打撤崩溃：常规自动填充重复塞 bot 导致内存耗尽

## 崩溃证据（crash-logs/launcher.log）

- `Fatal process out of memory: Zone`
- `FATAL ERROR: Committing semi space failed. Allocation failed`
- `FATAL ERROR: Zone Allocation failed - process out of memory`
- `node::Realloc` Assertion failed（`_moduleCompile` 期间分配失败）

全部是 **V8 内存分配失败**，发生在搜打撤的 bot worker（`mode-ai ... extraction`）
进程里；`server-crash.log` 无新增（V8 fatal 绕过 JS 处理器）。

## 根因

- **搜打撤房间被两套机制同时塞 bot**：
  1. 常规自动填充（`runBotAutoFillTick`，每 ~2s、每进程 8 个 bot）
     并没有排除搜打撤房间；
  2. 搜打撤专项补员（`tickExtractionReplenish`，每 4s、每批 2 个）。
- 两者并发塞 bot → worker 子进程迅速爆炸（一场对局十几秒内 spawning
  大量进程）→ 系统提交内存耗尽 → 各 worker 依次触发 V8 Zone/semi-space OOM，
  最终 devServer 也崩溃重启（日志里 2 次 "Failed running"）。

## 修复（server/src/gameServer.ts）

- 常规自动填充循环里**跳过搜打撤房间**（`gameMode.extractionMode`），
  搜打撤只由 `tickExtractionReplenish` 专项补员。

## 验证

- `test:extraction`、`test:all-modes` 通过；server `tsc` 通过。
