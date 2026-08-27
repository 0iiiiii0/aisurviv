# V123 正式版新手包（替换测试阶段新手包）

## 需求

- 新玩家仓库改为正式版新手包：ak47×2、762mm 子弹 200 发、二倍镜×2、
  1 级护甲两套、医疗用品（绷带 10 / 医疗包 2 / 汽水 4）。

## 实现（server/src/stash/stashManager.ts）

- `buildTestStarterItems`（每个物品×5 + 每种弹药×510 的测试发放）
  替换为 `buildStarterItems` 正式版新手包：
  - 枪械：ak47 ×2
  - 弹药：762mm ×200
  - 倍镜：2xscope ×2
  - 护甲（两套）：helmet01 ×2、chest01 ×2、backpack01 ×2
  - 医疗：bandage 10 / healthkit 2 / soda 4（无止痛药）
- 仍仅在玩家首次创建仓库时发放；老玩家仓库不受影响。

## 测试更新（server/src/extractionSmokeTest.ts）

- 同步所有依赖新手包数量的断言：
  - ak47 2、762mm 200、bandage 10、helmet01/backpack01/2xscope 各 2、
    无近战/9mm/投掷物/止痛药。
  - 依赖 9mm/glock 的用例（双枪扣弹、背包容量）显式 addItem 补齐。

## 验证

- `test:extraction`、`test:admin`、`test:all-modes`、
  `test:loot-capacity`、`test:duel` 全部通过。
