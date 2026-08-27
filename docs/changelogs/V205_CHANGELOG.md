# V205 地图彻底移除 + 修复 diagFrames + 固定缩放

## 问题

1. 背景仍为绿色（地图地面容器隐藏被重置/不彻底）；
2. 热重载后报「示例人物更新失败：diagFrames is not defined」
   （声明在编辑中丢失）。

## 修复

### client/src/storage.ts
- 地图地面容器（map.display.ground / renderer.ground）
  由隐藏改为**从舞台移除**（removeChild），不再渲染任何地图；
- 固定 `camera.zoom = 1.5`（玩家身体约 51px，大小适中）；
- 补回 `let diagFrames = 0;` 声明；
- 诊断增强：输出玩家屏幕坐标（playerScreen）与画布矩形
  （canvasRect），用于确认玩家与画布对齐。

## 验证

- client tsc + vite build：PASS
- 画布内只渲染人物（深色背景），无绿色地图
