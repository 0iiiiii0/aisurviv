# V84 阶段1：斯安威斯坦（Sandevistan）模式——服务端时间减速

## 需求

- 新增"斯安威斯坦"模式，还原赛博朋克2077植入体的核心体验：
  **激活后整个世界减速（子弹时间），只有使用者保持全速**。
- 该模式定位"全场 AI + 唯一真人"，因此采用服务器权威的全局时间减速。
- 本轮只做阶段1：服务端技能 + 物品 + 模式注册 + 双 dt 分发 + 测试。

## 玩法（v1 原型）

- 新模式"斯安威斯坦"（复用 Normal(main) 地图数据，地图标记
  `gameMode.sandevistanMode: true`），单人/双人/四人三个队伍规格。
- 真人按 Use 键激活植入体（useItem=sandevistan_chip）：
  - **世界时间缩放到 35%**：AI 玩家、子弹、投掷物、毒圈、空投等全部按
    35% 推进；只有施法者保持全速（移动/射击/换弹）。
  - 施法者额外移速 +20%、武器散布 ×0.5。
  - 持续 5 秒 → 冷却 25 秒；激活期间击杀 → 冷却 -4 秒。
- 多真人同时激活（防呆）：世界缩放取最慢的激活者。

## 实现

### shared 层
- `shared/gameConfig.ts`：`protocolVersion` 85 → 86；
  新增 `GameConfig.player.sandevistan` 参数块（worldTimeScale 0.35 /
  duration 5 / cooldown 25 / speedBonus 0.2 / spreadMult 0.5 /
  killCooldownReduce 4）。
- `shared/defs/mapDefs.ts`：`gameMode` 接口新增 `sandevistanMode?: boolean`。
- `shared/defs/maps/sandevistanDefs.ts`（新）：复用 Main 地图数据，
  mapId=100，gameMode 打 sandevistanMode 标记；注册进 `MapDefs`。
- `shared/defs/gameObjects/sandevistanChipDefs.ts`（新）：`sandevistan_chip`
  物品（type "sandevistan"，为阶段2 掉落/拾取预留）；注册进 `GameObjectDefs`。
- `shared/net/updateMsg.ts`：`serializeActivePlayer/deserializeActivePlayer`
  追加 `sandevistanActive` / `sandevistanRemaining` / `sandevistanCooldown`
  字段（写入 HUD 与滤镜数据）；`LocalDataWithDirty` 接口同步。

### server 层
- `server/src/config.ts`：`DefaultModes` 注册
  `battleRoyaleModes("sandevistan", "斯安威斯坦")`（默认关闭，后台可开启）。
- `server/src/game/game.ts`：
  - 新增 `sandevistanTimeScale()`：有激活者时返回 0.35（多激活取最慢）；
  - `update()` 拆分 `realDt` 与 `worldDt = realDt × scale`：
    gas/playerBarn/loot/bullet/projectile/smoke/airdrop/deadBody/decal/plane
    均用 worldDt；比赛计时、清理 ticker 等用 realDt。
- `server/src/game/objects/player.ts`：
  - 新增 `sandevistanActive/sandevistanRemaining/sandevistanCooldown`；
  - `activateSandevistan()`（仅 sandevistanMode、非激活、非冷却）；
  - `update()` 推进激活窗口与冷却（施法者用 realDt）；
  - `recalculateSpeed()` 激活时移速 ×(1+0.2)；
  - `handleDie` 激活期间击杀 → 冷却 -4s；
  - `InputMsg.useItem` 新增 `sandevistan_chip` 分支；
  - 观战/连接快照的 `activePlayerData` 补齐三字段。
- `server/src/game/objects/playerBarn.ts`：`update(worldDt, realDt)` 双 dt
  分发——施法者用 realDt，其余玩家用 worldDt。
- `server/src/game/weaponManager.ts`：施法者激活时 spread ×0.5。
- `server/src/bot/modeStrategy.ts`：`sandevistan` 归属 normal family
  （AI 行为复用 Normal 策略）。

## 测试

- 新增 `server/src/sandevistanSmokeTest.ts`（`test:sandevistan`）：
  - 激活前后 worldTimeScale 1 → 0.35 → 1；
  - 双 dt：施法者全速移动、AI 玩家按 worldDt 慢速移动；
  - 施法者移速加成；激活期间击杀减 CD；
  - 到期进冷却、冷却中拒绝激活、冷却后可再激活；
  - 非 sandevistan 地图拒绝激活。
- 回归：`test:v41-suite`（11 项，admin/all-modes 已更新到 50 playlists /
  18 maps）、`test:v53-matchmaking`、`test:worker-thread-room` 全部 PASS。
- 服务端构建（tsc）与客户端构建（vite）通过。

## 说明

- 阶段2（客户端 HUD + 蓝调滤镜 + 音效）与阶段3（AI 使用芯片、掉落变体、
  平衡调参）见 V84_PLAN.md。
- 协议升级 85→86：客户端与服务端使用同一份 shared 反序列化器，已同步。