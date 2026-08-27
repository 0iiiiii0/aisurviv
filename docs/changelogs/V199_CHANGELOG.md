# V199 双枪与单枪统一：双枪拆两把单枪存放，实战合成不占副槽

## 需求

1. 双枪形态与单枪视为同一种物品；
2. 双枪拆成两把单枪存放（仓库只存单枪）；
3. 携带两把相同单枪 → 实战自动装备双枪，不占用另一个武器槽位。

## 实现

### 共享（shared/defs/gameObjects/gunDefs.ts）
- 新增 `dualGunOf(base)` / `baseGunOf(type)` 映射
  （glock ↔ glock_dual 等 10 种双枪）。

### 服务端
- stashManager：
  - addItem / removeItem：双枪类型按两把单枪折算存放；
  - setLoadout：双枪写法（glock_dual）规范化为两把单枪；
  - getStash：旧双枪库存自动迁移为单枪 ×2；
- player.applyExtractionLoadout：两把相同单枪 → 主槽合成双枪
  （glock_dual），**副武器槽保持空**。

### 客户端（extractionStashUi.ts）
- 点击同一把枪第二次 = 装备第二把（双枪），第三次卸下一把；
- 左栏武器槽：双枪时主槽显示双枪图标 +「（双枪）」，
  副槽显示空（不占副武器槽）；
- 弹药提示按枪数计算需求（双枪 = 6 弹匣）。

## 验证

- addItem glock_dual → 仓库 glock ×2 ✓
- loadout ["glock_dual"] → ["glock","glock"] ✓
- 双枪合成：主槽 glock_dual、副槽空 ✓
- server tsc / client build / test:extraction（新增断言）：PASS
