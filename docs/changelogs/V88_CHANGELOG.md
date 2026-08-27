# V88 后台 UI 反馈整合（6 条浏览器评论）

## 需求（浏览器反馈）

1. 优化"创建纯 AI 1v1"工具卡 UI（AI1/AI2 难度+武器选择）。
2. 公开房间人数上限增加 50v50。
3. 模式网格中看不到四个特殊模式（50v50 / 1v1随机 / 1v1房间 / 2077·斯安威斯坦）。
4. 特殊模式分组改标题并置顶。
5. 顶部"自动刷新"默认开启。
6. 模式卡片方框闪烁问题。

## 实现

### 1. 纯 AI 1v1 工具卡（client/public/admin/index.html + admin.css）
- 卡片化 fieldset：AI1 / AI2 各含 难度 / 主武器 / 副武器 三行标签选择器；
- 底部"创建并生成观战链接 / 打开本局观战"操作区独立一行；
- 新增 .pure-ai-heading / .pure-ai-grid fieldset / .pure-ai-actions 样式。

### 2. 50v50 房间上限（server + UI）
- `server/src/config.ts`：`RoomPlayerLimitsConfig` 新增 `faction`（默认 100）；
- `server/src/botAutoFill.ts` / `game/gameManager.ts`：faction 房间上限取
  min(地图上限, 配置上限)；
- `server/src/adminServer.ts`：`/admin-api/room-player-limits` 接受第 4 参数
  `faction`（2–100）；
- 后台"公开房间人数上限"块新增"50v50"输入；
- 相关测试更新（adminSmokeTest / botAutoFillConfigSmokeTest /
  v41DuelRoomSmokeTest / v50UnifiedTargetDuelAdminSmokeTest）。

### 3/4. 特殊模式置顶分组（client/public/admin/admin.js + admin.css）
- 模式网格顶部新增"特殊模式"置顶分组（标题"特殊模式"，meta
  "X 开放 / 4 个特殊模式"），含 4 张卡片：
  50v50（faction）、2077·斯安威斯坦（sandevistan 三规格统一）、
  1v1 随机、1v1 房间（duel 配置）；
- 50v50 / 2077 切换复用 `setModeEnabled`；1v1 切换写入 duel draft 并同步
  1v1 配置面板开关；
- 移除旧的"特殊模式开关"面板（HTML/JS），统一由模式网格顶部组承载；
- `setModeEnabled` 支持 button 可选（特殊组卡片无独立按钮禁用）。

### 5. 自动刷新默认开启
- 无 localStorage 记录时默认 10 秒（`?? "10"`），首次进入即自动刷新。

### 6. 模式卡片闪烁
- 移除 `.mode-group-body` 的重建动画（mode-group-fade），消除每次自动
  刷新重建分组时的闪动。

## 测试

- server / client 构建通过；
- `test:v41-suite`（11 项）、`test:admin`、`test:v50-room-targets`、
  `test:bot-autofill-config`、`test:faction-autofill`、`test:sandevistan`
  全部 PASS。