# V200 修复示例人物位置（相机聚焦点对齐画布）

## 问题

示例人物区域只显示水面，状态栏无错误——人物实际已渲染，
但 **LoadoutDisplay 相机聚焦点（#modal-content-left）位于页面角落**，
玩家被渲染到画布之外的屏幕位置。

## 修复（client/storage.html）

- 将 `#modal-content-left` 从页面角落移入
  `#stash-player-canvas` **内部**（absolute 覆盖画布区域）；
- LoadoutDisplay 的相机偏移计算使玩家显示在
  modal 元素位置 = 画布中心，人物与画布完全对齐；
- 保留渲染诊断日志（每 2 秒输出 playerPos / texValid / camPos），
  便于后续定位。

## 验证

- client tsc + vite build：PASS
- 玩家渲染位置与画布对齐，不再出现在画布之外
