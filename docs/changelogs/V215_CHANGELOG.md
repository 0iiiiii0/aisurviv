# V215 背包容量与网络库存上限（510）

## 问题

1. 配装保存用仓库堆叠上限，入局直接写 inventory，未按最终背包等级
   限制容量（可绕过背包容量）；
2. 局内 inventory 为 9 bit，511 是无限物资哨兵；仓库允许部分物资
   999/1680，超限值截断为 511 会被客户端识别为无限。

## 修复（server/src/stash/stashManager.ts）

### 协议上限
- 普通可堆叠物资（弹药/药品/增益/投掷物/近战）库存上限 **510**
  （新增不超 510，已存在超限值不被减少）；
- 新手包弹药 600 → **510**。

### 背包容量
- `grantLoadout` 按**最终背包等级**限制发放：
  `capacity = GameConfig.bagSizes[type][背包等级]`
  （无背包 level 0；backpack01/02/03 → level 1/2/3）；
- 武器对应弹药、独立备用弹、药品、投掷物均受容量约束，
  并统一受 510 上限约束。

## 验证

- backpack01（level 1）配装 300 发 9mm → 发放 **240** ✓
- addItem 不超过 510、超限库存不减少 ✓
- server tsc / test:extraction（新增断言）/ admin / all-modes：PASS
