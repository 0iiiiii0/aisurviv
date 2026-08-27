# V193 护甲拆分为头盔 / 护甲 / 背包三个独立类别

## 需求

仓库中「护甲」分类拆成：头盔、护甲（胸甲）、背包三个独立分类。

## 实现

### 服务端（server/src/stash/stashManager.ts）
- `StashCategory` / `StashData` 的 `armor` 拆分为
  `helmets` / `chests` / `backpacks` 三个独立类别；
- `stashCategoryFor`：helmet → helmets、chest → chests、
  backpack → backpacks；
- 配装保存/扣除按对应类别校验；
- **旧数据自动迁移**：getStash 时把旧 armor 字段中的
  头盔/胸甲/背包分别并入新类别并清理。

### 客户端（extractionStashUi.ts + storage.html）
- 仓库新增「头盔」「护甲」「背包」三个分类
  （点击装备/卸下、右键移除）；
- 事件分支按三个类别处理。

## 验证

- 新手包：18 头盔 / 4 胸甲 / 4 背包 / 4 倍镜 各 5 个 ✓
- 旧 armor 字段迁移后不再出现 ✓
- 配装装备/扣除正常 ✓
- server tsc / client build / test:extraction：PASS
