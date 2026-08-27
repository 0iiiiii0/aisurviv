# V80 补齐目标合并：所有普通公开房间共用同一个"真人+AI"补齐目标

## 需求

- 删除"每个模式/每个模式族单独设置补齐目标"这一大段（V76 拆出的
  solo / duo / squad / 50v50 四个独立目标输入）。
- 所有普通公开房间（包括 50v50）共用同一个"真人+AI"补齐目标；
  AI 加入间隔保持全局统一（不按模式单独设置）。
- 实际目标不会超过该模式的房间人数上限。

## 现状

- V76 把补齐目标拆成 4 个独立设定：单人 / 双人 / 四人 / 50v50，
  后台 UI 有 4 个输入框 + 每模式一张卡片的大表格。
- V58/V77 已把 AI 加入间隔统一为后端全局值，每模式不再单独设置。

## 实现

### 配置（server/src/config.ts）
- `BotAutoFillConfig` 把 `soloTargetPlayerCount` / `duoTargetPlayerCount` /
  `squadTargetPlayerCount` / `factionTargetPlayerCount` 四个字段合并为
  一个 `targetPlayerCount`（所有普通公开房间共用的真人+AI 补齐目标）。
  默认值 80：普通模式被 20 上限钳制到 20，50v50 被 100 上限钳制到 80。
- `migrateLegacyBotAutoFillConfig`：旧配置文件带四目标时，取四者最大值
  写入 `targetPlayerCount` 并删除旧字段（升级不缩水）；已有显式共享目标
  则原样保留。
- 启动归一化：`targetPlayerCount` clamp 到 1–100。

### 补齐策略（server/src/botAutoFill.ts + server/src/game/gameManager.ts）
- `getBotAutoFillPolicy` / `roomFillInfo` 不再按 teamMode / faction 分支，
  一律使用 `Config.botAutoFill.targetPlayerCount`，
  实际目标 = `min(目标, 该模式房间人数上限)`。

### 管理后台（server/src/adminServer.ts + client/public/admin/）
- 后端 `/bot-autofill` 接口参数改为
  `defaultJoinIntervalMs + targetPlayerCount + 难度/频率相关`；
  快照输出单一 `targetPlayerCount`。
- 后台 UI：4 个"单人/双人/四人/50v50补齐目标"输入框合并为 1 个
  "真人+AI补齐目标（所有普通公开房间共用，含50v50）"；
  模式卡片仍显示每个模式的"房间上限"与 min 后的实际补齐目标。

## 效果（默认全局目标 80 时）

| 模式 | 房间上限 | 真人+AI 实际补齐 |
| --- | --- | --- |
| Normal/Potato/Desert/Woods/Savannah/Cobalt/Turkey/Halloween/Snow/春季/夏季 各 单人/双人/四人 | 20 | 20 |
| 50v50 | 100 | 80 |

## 测试

- `botAutoFillConfigSmokeTest`：所有模式（含 50v50）共用同一目标并按各自
  房间上限钳制。
- `factionAutoFillSmokeTest` / `adminSmokeTest` / `v50UnifiedTargetDuelAdminSmokeTest`：
  更新到单一 `targetPlayerCount`，覆盖迁移合并、快照、接口与 UI 断言。
- 服务端/客户端构建通过；`test:v41-suite`（11 项）、`test:v53-matchmaking`、
  `test:worker-thread-room` 全部回归 PASS。