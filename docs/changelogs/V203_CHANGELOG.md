# V203 强制玩家显示在画布中心（相机覆盖）

## 问题

诊断确认玩家已正常渲染（texValid=true、visible=true），但屏幕位置
(396, 271) 超出画布（画布位于页面左上 x≈16-296）——只有一片水。

## 根因

LoadoutDisplay 的相机偏移（getCameraLoadoutOffset）按**主界面弹窗布局**
计算，把玩家放在 `#modal-content-left` 的**右侧**；在仓库页面中该元素
位于画布内，玩家因此被推到画布右侧之外。

## 修复（client/src/storage.ts）

- 每帧 `display.update()` 后**覆盖相机位置**：
  按 `canvasHost.getBoundingClientRect()` 计算画布中心屏幕坐标，
  反推 `camera.pos`，使玩家始终显示在**画布中心**；
- 缩放（zoom/targetZoom）保持 LoadoutDisplay 计算值（玩家恒定 68px）；
- 诊断日志保留。

## 验证

- client tsc + vite build：PASS
- 玩家屏幕位置 = 画布中心，不再偏移到画布外
