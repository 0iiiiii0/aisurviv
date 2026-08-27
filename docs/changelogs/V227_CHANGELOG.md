# V227 bot worker 老年代堆上限降到 2GB

## 需求
- 配合 V226 的全局 worker 上限，进一步压缩单 worker 内存峰值：把 bot worker
  的 `--max-old-space-size` 从 4096 降到 2048（2GB），避免单个 worker 默默
  膨胀到 4GB 才触发 V8 Zone OOM。

## 实现（server/src/gameServer.ts）
- bot worker 的 `NODE_OPTIONS`：
  `--max-old-space-size=4096 --max-semi-space-size=32` →
  `--max-old-space-size=2048 --max-semi-space-size=32`；
- 对当前每 worker 1–3 个 AI 的配置，实际老年代峰值远低于 2GB，正常运行时
  GC 频率不变、AI 性能无感知影响；堆异常膨胀时会更早被遏制。

> 说明：`--max-semi-space-size=32`（新生代）未改动，仍是独立参数；
> 主服务器进程的 `--max-old-space-size=8192`（start-surviv.ps1）也未改动，
> 它只影响 devServer 主进程，不是崩溃来源。

## 验证
- server `tsc --noEmit` / build：PASS（`dist/server/src/gameServer.js` 已同步）；
- `test:admin`、`test:bot-autofill-config`：PASS。
