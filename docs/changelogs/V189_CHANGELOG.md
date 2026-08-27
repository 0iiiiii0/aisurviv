# V189 仓库示例人物改用主界面同款完整游戏渲染

## 需求

人物模型仍与游戏不同；对照主界面「示例载入」的示例人物实现方式。

## 实现

### 复用 LoadoutDisplay（client/src/ui/opponentDisplay.ts）
- 新增 `previewLook` 与 `setPreviewLook()`：可覆盖示例人物的
  outfit / 头盔 / 护甲 / 背包 / 手持武器（主武器枪优先，其次近战）；
- 预览模式下固定 Anim.None（静止站立展示），不再触发挥动动画；
- 其余渲染完全复用主界面示例人物管线：
  Renderer + PlayerBarn + Map + 完整 Player 对象（骨骼/贴图/装备）。

### /storage 页面（client/src/storage.ts + storage.html）
- 用 LoadoutDisplay 实例化示例人物（依赖最小 stub：
  AudioManager / ConfigManager / InputHandler / InputBinds / account）；
- `#modal-content-left` 占位元素满足 resize 的 DOM 依赖；
- 配装变化通过 `onLoadoutChanged` 自动刷新示例人物；
- 移除手动拼装方案（storagePlayer 不再引用）。

## 验证

- client tsc + vite build：PASS
- 示例人物与主界面「示例载入」完全同一渲染实现
