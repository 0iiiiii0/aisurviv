# V177 缩小展示角色尺寸

## 需求

角色作为展示用途不需要太大，缩小显示。

## 实现

### client/src/storagePlayer.ts
- `fitToFrame()` 增加 `maxFill = 0.62`：角色整体（含武器）最大占画布的
  62%，并继续按包围盒自动缩放、居中；
- 默认外观与配装更新后同样生效。

## 验证

- client tsc + vite build：PASS
- 角色显示约为画布的 62%，留白更舒适
