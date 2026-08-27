# V174 修复仓库小人显示错误

## 问题

PIXI 渲染的角色各部件全部叠在身体中心（手/脚位置未按游戏内骨骼摆放），
显示异常。

## 修复

### client/src/storagePlayer.ts
- 手/脚改为左右各一个 sprite（handL/handR、footL/footR），
  位置按游戏内 `IdlePoses.fists` 骨骼坐标放大 k=3.4 倍：
  - HandL (14, -12.25)、HandR (14, 12.25)
  - FootL (-15.75, -9)、FootR (-15.75, 9)
- 武器缩放修正：`worldImg.scale × 0.5 × k`
  （与游戏内 zoom=1 的基础 0.5 缩放一致，避免枪身过长）；
- 部件层级：身体 → 手/脚 → 胸甲 → 头盔 → 背包 → 武器。

## 验证

- client tsc + vite build：PASS
- 手/脚/武器按游戏内骨骼比例分布，不再叠在中心
