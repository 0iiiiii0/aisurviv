# V121 搜打撤补员批次按机器自适应

## 背景

- 运行环境不同：办公机（内存紧张，出现过 V8 Zone OOM 崩溃）vs
  实际游戏服务器（核心多、主频低、空闲内存多）。
- 固定的"3 个 AI/进程"在办公机省内存，但在服务器浪费多核并行
  （主频低时更需要每 AI 独立进程来保证决策频率）。

## 实现

### 可配置（server/src/config.ts）
- 新增 `botAutoFill.extractionReplenishBatch`：
  - `> 0`：固定使用该批次（1 = 每 AI 一个进程）。
  - `0`（默认）：按机器资源自适应。

### 自适应（server/src/gameServer.ts）
- `resolveExtractionReplenishBatch()`：
  - 核心 ≥ 8 且空闲内存 ≥ 16GB（生产服务器）→ **1 个 AI/进程**，
    多用多核并行，弥补主频低。
  - 空闲内存 ≥ 8GB（办公机）→ 2 个/进程。
  - 内存紧张 → 3 个/进程（省内存，防 V8 Zone OOM）。

## 验证

- 本机（16 核 / 8.5GB 空闲）→ 批次 2；内存充足的生产服务器 → 批次 1。
- server `tsc` 通过；`test:extraction`、`test:admin` 通过。
