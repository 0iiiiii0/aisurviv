# V194 修复示例人物更新崩溃（未装备背包时读 level）

## 问题

仓库页面报错「示例人物更新失败：Cannot read properties of undefined
(reading 'level')」，示例人物不可见。

## 根因

`Player.getBagLevel()` 直接执行
`GameObjectDefs[this.netData.backpack].level`；
当配装未装备背包（backpack 为空字符串）时 `GameObjectDefs[""]` 为
undefined → 读 `.level` 抛错，每帧更新中断。

## 修复（client/src/objects/player.ts）

- `getBagLevel()` 增加空值与缺失定义守卫：无背包/无效类型返回 0；
- 头盔/胸甲已有同样守卫（getHelmetLevel / getChestLevel），不受影响；
- 未装备背包时示例人物正常显示为无背包状态。

## 验证

- client tsc + vite build：PASS
- 无背包配装不再触发更新异常
