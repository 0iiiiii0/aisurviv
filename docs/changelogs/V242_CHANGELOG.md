# V242 搜打撤加入窗口：绝密 2 分钟 / 普通满员后真人可进（5 分钟前）

## 需求
- 绝密模式**最晚开局 2 分钟加入**（普通搜打撤仍是 5 分钟）；
- 普通搜打撤允许**人数上限后加入真人**（5 分钟前）：真人加入满员房间时，
  系统挤掉一个 AI 腾位，总人数不超上限。

## 实现

### 服务端
- `shared/defs/extractionDefs.ts`：新增 `EXTRACTION_SECRET_JOIN_LIMIT_SECONDS = 120`；
- `game/game.ts`：
  - `canJoin` 按模式区分：绝密 = 人数上限 + 开局 2 分钟窗口；
    普通搜打撤 = 5 分钟窗口（满员也可加入）；
  - 新增 `secretJoinableWindowOpen` / `canAcceptExtractionHuman()` /
    `evictOneAiForHuman()`（优先踢已断线 AI，其次最早加入的 AI；
    先发 Disconnect 让 bot 不再重连，再移除玩家对象并关闭 socket）；
  - `extractionSecretEnabled()` 优先使用建房间时的配置快照
    （生产多进程与匹配端一致），未携带时回退到本进程 Config；
- `game/gameManager.ts`：`ServerGameConfig` 新增 `extractionSecretEnabled`，
  建房间时把主进程绝密开关快照下发；
- `game/gameProcessManager.ts`：`GameProcess` 记录绝密快照；生产匹配时
  普通搜打撤不再受 `avaliableSlots > 0` 限制（满员真人由房间侧挤 AI）；
- `game/objects/player.ts`：`addPlayer` 增加真人加入门槛——绝密超 2 分钟 /
  满员拒绝；普通满员时挤掉一个 AI 腾位，无 AI 可踢（几乎全是真人）则拒绝。

## 验证
- 新增 `server/src/extractionJoinWindowSmokeTest.ts`（`test:extraction-join-window`）：
  - 普通模式满员 20 AI → 真人加入成功，AI 数 -1、总人数保持 20；
  - 优先踢已断线 AI；
  - 全是真人、无 AI 可踢时第 21 个真人被拒绝；
  - 普通模式超过 5 分钟（startedTime=301）拒绝真人；
  - 绝密模式 120 秒可加入、121 秒拒绝；
  - 绝密模式满员不踢 AI、拒绝真人；
- `tsc --noEmit` PASS；既有 extraction / extraction-secret / no-gas /
  game-process-reuse / v53 冒烟测试全部 PASS。
