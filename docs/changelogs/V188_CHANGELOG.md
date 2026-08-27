# V188 倍镜独立类别 + 新手包移除默认一倍镜

## 需求

1. 倍镜不再归类为护甲，单开一个类别；
2. 一倍镜是默认派发装备（所有状态默认自带），不需要进仓库/新手包。

## 实现

### 服务端（server/src/stash/stashManager.ts）
- StashData 新增独立 `scopes` 类别（scope 物品存这里，
  不再混入 armor）；
- `stashCategoryFor`：`scope` → `scopes`；armor 仅含头盔/胸甲/背包；
- 配装保存/扣除：scope 从 scopes 类别校验与扣除；
- 新手包移除 `1xscope`（默认派发，不占仓库）。

### 客户端（extractionStashUi.ts + storage.html）
- 仓库新增「倍镜」分类（1x/2x/4x/8x/15x，点击装备/卸下、
  右键移除）；
- 护甲分类过滤旧数据中残留的 scope 物品（兼容旧仓库文件）；
- 左栏装备摘要仍显示当前倍镜。

## 验证

- 新手包 armor 无倍镜、scopes 为空 ✓
- 2xscope 存入独立 scopes 类别、可装备 ✓
- server tsc / client build / test:extraction：PASS
