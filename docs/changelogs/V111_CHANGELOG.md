# V111 提升仓库弹药与医疗用品存储上限

## 需求

- 提升所有仓库弹药和医疗用品（药品/增益）的存储上限。

## 实现（server/src/stash/stashManager.ts）

- `stackCap`：弹药/药品/增益统一提升到协议上限 **510**
  （此前按 `bagSizes 最大档 × 4` 计算，如 12gauge 360、308sub 320、
  信号弹 32、绷带 120、医疗包/止痛药 16、汽水 60）。
- 仓库可多存，进局携带量仍受背包容量（bagSizes）限制，不受影响。

## 验证

- `test:extraction`（含 510 协议上限断言）通过。
- server `tsc` 通过。
- 文档 `docs/STASH_CAPACITY.md` 已同步更新。
