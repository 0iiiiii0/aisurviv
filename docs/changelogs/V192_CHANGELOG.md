# V192 示例人物不可见排查与容错

## 问题

改用 LoadoutDisplay 后人物依旧不可见。

## 处理

### client/src/storage.ts
- **错误可见化**：贴图加载失败 / LoadoutDisplay 初始化失败 /
  每帧更新异常都会显示到页面状态栏（不再静默）；
- **回退机制**：LoadoutDisplay 不可用时自动回退到手动拼装
  （StoragePlayer），保证人物至少可见；
- 每帧 update 包 try/catch，出错时停止 ticker 并提示。

### 检查结论
- loadout atlas（玩家/装备/武器贴图）已确认先加载；
- camera 聚焦与缩放计算在独立页面尺寸下正常（玩家恒定 68px 屏幕）；
- 依赖 stub（ConfigManager/AudioManager/InputHandler/InputBinds/
  account）均为轻量可运行实例。

## 验证

- client tsc + vite build：PASS
- 刷新 /storage 后若仍有问题，状态栏会直接显示错误信息，
  便于下一步定位
