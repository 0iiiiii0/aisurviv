# V85 后台 UI 调整：补齐目标拆回4个 + 人数设置集中 + 删除模式网格

## 需求（浏览器反馈）

1. 删除"人机自动补入"里按每个模式展示的房间上限/补齐目标网格（无意义）。
2. 优化"房间管理"模块上半部分 UI。
3. "真人+AI 补齐目标"不要共用 1 个输入，拆成 4 个：单人 / 双人 / 四人 / 50v50；
   所有设置人数的控件放在同一块，不要分开。

## 实现

### 服务端：补齐目标拆回 4 个（回退 V80 的合并）
- `server/src/config.ts`：`BotAutoFillConfig` 恢复
  `soloTargetPlayerCount / duoTargetPlayerCount / squadTargetPlayerCount /
  factionTargetPlayerCount`（默认 20/20/20/80）；
  迁移逻辑：旧共享 `targetPlayerCount`（V80）拆成 4 个（普通模式由房间上限
  钳制，行为等价）；已拆分配置保持不变并清除残留共享字段。
- `server/src/botAutoFill.ts` / `server/src/game/gameManager.ts`：
  `getBotAutoFillPolicy` / `roomFillInfo` 按单人/双人/四人/50v50 选择各自目标，
  实际目标仍不超过房间上限。
- `server/src/adminServer.ts`：`/bot-autofill` 接口与快照恢复 4 个目标参数。

### 后台 UI
- **人机自动补入（bots）**：
  - 删除"真人+AI 补齐目标"单输入（移到房间管理）；
  - 删除每模式"房间上限/补齐目标"网格（bot-autofill-grid 及相关 JS/CSS）；
  - 保留 AI 统一加入间隔、AI 类型占比、各等级运行频率。
- **房间管理（rooms）**：
  - 上半部分重构为统一的"人数设置"面板（room-config-panel），两块并排：
    1. 公开房间人数上限（单排/双排/四排）；
    2. 真人+AI 补齐目标（单人/双人/四人/50v50）；
  - 两块各自一个保存按钮；保存补齐目标会一并持久化间隔/占比/频率的当前值；
  - 纯 AI 1v1 工具卡与房间表格保持不变。
- `client/public/admin/admin.css`：新增 room-config-panel 等样式。

### 测试
- `adminSmokeTest` / `botAutoFillConfigSmokeTest` / `factionAutoFillSmokeTest` /
  `v50UnifiedTargetDuelAdminSmokeTest` 更新到四目标：接口、快照、策略、
  迁移（V80 共享值 → 4 个）、HTML/JS 断言（4 个目标输入存在、网格不存在）。
- 服务端/客户端构建通过；`test:v41-suite`（11 项）、`test:v53-matchmaking`、
  `test:worker-thread-room`、`test:sandevistan` 全部 PASS。