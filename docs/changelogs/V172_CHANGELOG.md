# V172 右键减少与左键携带使用相同步长

## 需求

右键一次减少的数量与左键一次携带的数量一致。

## 实现

### client/src/extractionStashUi.ts
- 提取共用 `carryStep()`：弹药 30（信号弹 1、.308 AWM 弹药 5）、
  绷带 5、其余 1；
- 左键携带：`+carryStep`（受仓库剩余限制）；
- 右键减少：`−carryStep`（下限 0，归零时移除该物资项）。

## 验证

- client tsc + vite build：PASS
- 右键减少量 = 左键携带量（弹药 30 / 信号弹 1 / .308 5 / 绷带 5 / 其他 1）
