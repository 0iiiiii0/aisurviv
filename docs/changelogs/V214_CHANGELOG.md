# V214 修复结算不守恒（双枪弹药 / 倍镜重复入库 / 默认 1x 倍镜）

## 问题

1. 两把同口径武器扣两次备用弹药（第二次覆盖第一次，实扣双倍）；
2. 当前倍镜既从 inventory 入库又单独入库一次（重复）；
3. 默认 1x 倍镜凭空进入仓库。

## 修复（server/src/stash/stashManager.ts）

### grantLoadout
- 新增 `grantedAmmoTypes` 集合：**同口径备用弹药只扣一次**
  （双枪共用一份备用弹，不再重复扣仓）。

### collectCarriedLoot
- inventory 循环：跳过 `1xscope`（默认派发不进仓库）、
  跳过 scope 类别（倍镜由下方装备循环统一入库一次）；
- 装备循环：跳过 `1xscope`。

## 验证

- 双枪 [glock, glock] + 9mm 100：只扣 100（非 200）✓
- 收集 inventory(2xscope)+scope(2xscope)：2xscope 仅 +1 ✓
- 收集 1xscope：不入库 ✓
- server tsc / test:extraction（新增断言）：PASS
