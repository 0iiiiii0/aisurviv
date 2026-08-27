# V219 后台 AI 配装修改同步到房间 worker

## 问题

后台修改 extractionAiLoadouts 后，已启动或复用的房间 worker 仍使用
进程创建时的旧快照（ServerGameConfig 未携带 AI 配装）。

## 修复

### server/src/game/gameManager.ts
- `ServerGameConfig` 新增
  `extractionAiLoadouts?: readonly ExtractionAiLoadoutPresetConfig[]`；
- `createServerGameConfig` 在创建 **extraction 房间**时把
  `Config.extractionAiLoadouts` 随配置快照下发（随 CreateGameMsg
  跨进程传递）。

### server/src/game/game.ts
- `applyExtractionSpawnLoadout` 优先使用
  `this.config.extractionAiLoadouts`（房间快照），回退全局 Config。

## 验证

- server tsc / test:extraction / test:admin：PASS
- 新建 extraction 房间的 worker 使用创建时的最新 AI 配装
