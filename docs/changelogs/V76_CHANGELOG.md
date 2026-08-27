# V76 补齐目标拆分为 4 类：单人 / 双人 / 四人 / 50v50

## 需求

- 全部正常房间的补齐目标（真人+AI）不再共用一个值，而是拆成 4 个独立设定：
  单人一个、双人一个、四人（squad）一个、50v50 一个。

## 现状

- 旧的 `BotAutoFillConfig` 只有两个目标：
  - `targetPlayerCount`（solo/duo/squad 共用）；
  - `factionTargetPlayerCount`（50v50）。

## 实现

### 配置（server/src/config.ts）
- `BotAutoFillConfig` 把 `targetPlayerCount` 拆为：
  `soloTargetPlayerCount` / `duoTargetPlayerCount` / `squadTargetPlayerCount`；
  保留 `factionTargetPlayerCount`（50v50）。默认均 20。
- 启动归一化：四个目标各自 clamp 到 1–100；旧文件若带共享 `targetPlayerCount`
  或 V15-V49 legacy 上限，迁移时用该值填充三个普通目标并删除旧字段。
- `migrateLegacyBotAutoFillConfig`：显式旧共享目标优先于 legacy 上限。

### 补齐策略（server/src/botAutoFill.ts + game/gameManager.ts）
- `getBotAutoFillPolicy` 按 `teamMode`/faction 选取对应目标：
  faction → `factionTargetPlayerCount`（未设置时回退到 squad 目标）；
  solo/duo/squad → 各自的独立目标（未设置时回退 20）。
- `matchmakingFillInfo` 同样按房间类型选取。

### 管理后台（server/src/adminServer.ts + client/public/admin/）
- 后端 `/bot-autofill` 接口参数改为四目标；快照输出四字段。
- 后台 UI：`bot-target-player-count`（共用）替换为
  `bot-solo/duo/squad-target-player-count` 三个输入 + 原 50v50 输入，
  模式卡片按各自 teamMode 显示实际补齐目标。

## 测试

- `botAutoFillConfigSmokeTest` / `factionAutoFillSmokeTest` /
  `adminSmokeTest` / `v50UnifiedTargetDuelAdminSmokeTest` 更新到四目标，
  并覆盖"50v50 未设置时回退 squad 目标"与旧配置迁移。
- 服务端/客户端构建通过；`test:v41-suite`（11 项）及 V53–V75 全部回归 PASS。