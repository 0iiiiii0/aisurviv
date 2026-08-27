# V122 搜打撤补员：空闲内存 ≥ 10GB 时每 AI 独立进程

## 需求

- 空闲内存 ≥ 10GB 就每 AI 独立进程。

## 实现（server/src/gameServer.ts）

- `resolveExtractionReplenishBatch()` 阈值调整：
  - 空闲内存 **≥ 10GB** → 1 个 AI/进程（多用多核并行）。
  - ≥ 5GB → 2 个/进程。
  - < 5GB → 3 个/进程（省内存，防 V8 Zone OOM）。
- 仍可通过 `botAutoFill.extractionReplenishBatch` 显式覆盖（0 = 自适应）。

## 验证

- 本机（约 8.5GB 空闲）→ 批次 2；空闲内存 ≥ 10GB 的生产服务器 → 批次 1。
- server `tsc` 通过。
