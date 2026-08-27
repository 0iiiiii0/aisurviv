# V248 绝密 AI 与普通 AI 采用不同配装

## 需求
- 绝密 AI 和普通搜打撤 AI 使用**不同的配装**（不再共用一套）。

## 实现

### 服务端
- `extractionLoadouts.ts`：新增 `defaultExtractionSecretAiLoadouts`（绝密默认
  配装，明显更强：M4A1 / SV98 / M249 + 三级护甲 + 倍镜 + 充足医疗，
  权重 40 / 30 / 30）；
- `config.ts`：新增 `Config.extractionSecretAiLoadouts`（独立于
  `extractionAiLoadouts`）与 `saveExtractionSecretAiLoadouts()`；
- `gameManager.ts`：`ServerGameConfig` 新增 `extractionSecretAiLoadouts`，
  建房间时随快照下发（生产多进程与主进程一致）；
- `game.ts`：`applyExtractionSpawnLoadout` 按绝密开关分别抽取——
  绝密 AI 用绝密配装，普通 AI 用普通配装；绝密仍额外套用最终幸存者能力；
- `adminServer.ts`：`GET/POST /admin-api/extraction/secret-ai-loadouts`
  （独立读取/保存绝密配装）。

### 后台
- `admin/index.html` + `admin.css`：绝密模式块内新增「绝密 AI 配装」编辑器
  （与普通配装完全独立）；
- `admin.js`：配装编辑器参数化（`renderExtractionLoadouts` /
  `collectExtractionLoadouts` 支持前缀），普通与绝密各持一份编辑状态、
  自动刷新互不干扰。

## 验证
- 新增 `server/src/extractionSecretLoadoutSmokeTest.ts`
  （`test:secret-loadout`）：
  - 绝密 bot 使用绝密配装（helmet03 / chest03 / A-S 武器），并保留
    最终幸存者能力（endless_ammo）；
  - 普通 bot 不使用绝密三级护甲（helmet/chest ≠ 03）；
- server `tsc` PASS；client `vite build` PASS。
