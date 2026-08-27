# V190 修复示例人物消失 + 右上角按钮改「确认配装」

## 问题

1. 改用 LoadoutDisplay 后人物模型直接消失：
   独立页面没有加载游戏贴图集（loadout atlas），
   Player 渲染的 `Texture.from("player-*.img")` 全部为空纹理；
2. 右上角按钮需改为「确认配装」。

## 修复

### client/src/storage.ts
- `createLoadoutDisplay` 改为异步：先加载 **loadout atlas**
  （assets/loadout-0-100-*.png + Spritesheet.parse），
  再创建 PIXI 应用与 LoadoutDisplay；
- 「确认配装」按钮：点击时若已输入玩家名先保存配装，再返回游戏；
  未输入名字则阻止跳转并提示。

### client/storage.html
- 右上角按钮「返回游戏」→「确认配装」（id: storage-confirm）。

## 验证

- client tsc + vite build：PASS
- loadout atlas 加载后 Player 纹理正常，示例人物重新可见
