# V204 只渲染人物不渲染地图 + 画布中心定位

## 问题

依旧只有一片水：LoadoutDisplay.update 每帧按主界面布局重置相机，
玩家 sprite 位置在 update 内部用旧相机计算，外部覆盖相机无效。

## 修复

### client/src/ui/opponentDisplay.ts
- 新增 `previewCameraCenter`：仓库预览模式下 update 内直接按
  **画布中心屏幕坐标**反推相机位置（不再用主界面弹窗偏移），
  玩家 sprite 位置随之正确。

### client/src/storage.ts
- 每帧设置 `previewCameraCenter = canvasHost 中心`；
- **隐藏地图地面容器**（map.display.ground / renderer.ground），
  只渲染人物（背景为深色画布底色）；
- 移除外部覆盖相机的旧方案。

## 验证

- client tsc + vite build：PASS
- 人物显示在画布中心、无地图背景
