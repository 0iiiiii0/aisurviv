# V171 仓库人物改为游戏内同款 PIXI 角色渲染

## 需求

仓库左栏的人物要像游戏内视角看到的自己一样（真实游戏角色），
不是抽象的 CSS 小人/图片。

## 实现

### client/src/storagePlayer.ts（新增）
- 用 pixi.js 创建 320×330 舞台，加载游戏 **loadout atlas**
  （assets/loadout-0-100-*.png，与游戏内同一贴图集）；
- 按游戏内拼装方式渲染角色：
  - 身体 `player-base-01.img`（默认服装 tint）
  - 手 `player-hands-01.img`、脚 `player-feet-01.img`
  - 胸甲 `player-armor-base-01.img`（装备时，含等级 tint）
  - 头盔 `player-circle-base-01.img`（装备时，头部位置）
  - 背包 `player-circle-base-01.img`（装备时，背后位置）
  - 主武器 `worldImg.sprite`（如 gun-m4a1-01.img，握持位置）
- `updateLoadout()` 随配装变化实时更新角色外观。

### client/storage.html + storage.ts + storage.css
- 移除 CSS 小人与 DOM 装备槽，改为 `#stash-player-canvas`；
- storage.ts 通过 `setOnLoadoutChanged` 订阅仓库配装变化，
  自动刷新 PIXI 角色；
- extractionStashUi 新增 `onLoadoutChanged` 回调机制
  （loadStash / persistLoadout 后触发）。

## 验证

- /storage 页面：stash-player-canvas 存在、CSS 小人/槽位已移除 ✓
- atlas 资源 HTTP 200；所有帧（身体/手/脚/护甲/枪）在 loadout atlas ✓
- client tsc + vite build：PASS
