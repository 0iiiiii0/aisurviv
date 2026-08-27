# V191 关闭添加物资 + 测试阶段全物资新手包

## 需求

1. 关闭仓库的「添加物资」功能；
2. 测试阶段所有玩家初始拥有全部物资：每种 5 个、弹药 600 发。

## 实现

### 关闭添加物资
- storage.html 移除「添加物资」输入行；bindStashEvents 移除添加按钮绑定；
- 服务端 HTTP 添加接口保留（撤离回收等内部使用不受影响）。

### 全物资新手包（server/src/stash/stashManager.ts）
- 新增 `buildTestStarterItems()`：遍历全部可拾取物资
  （枪械 / 近战 / 弹药 / 药品 / 护甲 / 倍镜 / 投掷物），
  每类数量 = 5，弹药 = 600；
- 排除默认装备：fists（拳头）、1xscope（默认派发倍镜）；
- 仅在首次创建仓库记录时发放一次。

## 验证

- 新玩家：65 枪 / 41 近战 / 9 弹药(600) / 4 药品 / 26 护甲 /
  4 倍镜 / 13 投掷物，全部 5 个（弹药 600）✓
- 1xscope / fists 不进仓库 ✓
- server tsc / client build / test:extraction：PASS
