# V87 阶段2：斯安威斯坦客户端 HUD + 冷却倒计时 + 蓝调滤镜

## 需求

- V84 阶段1 完成服务端世界时间减速后，本阶段补齐客户端表现：
  HUD 技能槽、冷却倒计时、全屏蓝调滤镜。
- 音效与物品图片暂空（图标用 "S" 占位）。

## 实现

### 游戏 HUD（client/index.html）
- 新增技能槽 `#ui-sandevistan-skill`（底部、健康条上方）：
  - 图标占位（"S" 圆形）；
  - 状态文字（斯安威斯坦）+ 计时器；
  - 冷却/充能条（readiness 进度）。
- 新增全屏滤镜 `#sandevistan-filter`（canvas 之上、HUD 之下，z-index 5）。

### 客户端状态（client/src/objects/player.ts）
- `localData` 新增 `sandevistanActive / sandevistanRemaining /
  sandevistanCooldown`；
- `setLocalData` 每次 update 解析这三个字段（服务端每帧固定写入）。

### HUD 更新（client/src/ui/ui2.ts）
- `dom` 增加 sandevistan 元素引用；
- `update()` 每帧：
  - 仅 sandevistan 模式显示技能槽（`map.mapDef.gameMode.sandevistanMode`）；
  - 激活时显示剩余秒（如 4.2s）、图标高亮、充能条满、滤镜开启；
  - 冷却中显示剩余整秒、充能条按冷却进度回充；
  - 就绪时显示"就绪"；
  - 非本模式移除滤镜。

### 样式（client/css/game.css）
- 技能槽 / 图标 / 计时 / 充能条 / 蓝调滤镜（半透明蓝、淡入淡出）。

## 测试

- 客户端构建（tsc --noEmit && vite build）通过；服务端构建通过。
- `test:v41-suite`（11 项）、`test:sandevistan` 全部 PASS。

## 说明

- 音效、物品/技能图标图片留空（占位 "S"），后续阶段补齐。
- 协议字段已在 V84 提供，客户端与服务端同步（86）。