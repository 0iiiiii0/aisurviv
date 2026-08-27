# V170 携带物资按组添加

## 需求

点击携带时按组添加：弹药一次 30 发（信号弹 1 发、AWM/.308 弹药 5 发），
绷带一次 5 个；仓库剩余不足时全部带上。

## 实现

### client/src/extractionStashUi.ts（adjustCarry）
- 左键携带改为按步长添加：
  - 弹药：默认 **30**（`flare` 信号弹 1、`308sub`（AWC/AWM 狙击）5）；
  - 绷带（bandage）：**5**；
  - 其余物资（药品/投掷物等）：1；
- 步长受仓库剩余限制：`take = min(step, 仓库数量 - 已携带)`，
  剩余不足时全部带上；无剩余则不操作；
- 右键仍为 -1 精细调整。

## 验证

- client tsc + vite build：PASS
- 携带量规则：9mm/762mm/556mm 等 +30；flare +1；308sub +5；
  bandage +5；healthkit/soda/frag 等 +1
