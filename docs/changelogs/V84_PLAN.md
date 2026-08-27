# V84 规划：斯安威斯坦（Sandevistan）模式

> 目标：新增一个游戏模式，还原《赛博朋克2077》斯安威斯坦（Sandevistan）
> 植入体的核心体验——**激活后整个世界减速（子弹时间），只有使用者保持全速**。
> 该模式定位为"全场 AI + 唯一真人"，因此可以做服务器权威的**全局时间减速**，
> 不存在"其他真人看到世界慢动作不公平"的问题。

## 一、玩法设计

1. 新模式"斯安威斯坦"（复用 Normal(main) 地图，地图标记 `sandevistanMode: true`）。
2. 全场玩家：**1 名真人 + 其余全部 AI**（自动补齐走现有 botAutoFill）。
3. 真人开局携带**斯安威斯坦芯片**，按 **Use 键** 激活，进入"子弹时间"。
4. **激活期间（持续 5 秒）**：
   - **世界时间减速到 35%**：所有 AI 玩家、AI 子弹、投掷物、毒圈、空投等
     全部按 35% 速度推进（看起来世界凝固，只有真人全速移动/射击/换弹）。
   - 使用者移速额外 +20%（超频感更足）、散布减半。
   - 世界减速对使用者同样"可见"：AI 几乎静止，真人可以轻松预判命中。
5. **限制**：激活结束后冷却 25 秒；冷却期间无法再激活。
6. **进攻激励**：激活期间击杀 AI → 冷却额外 -4 秒。
7. **视觉**：真人端全屏蓝色调 + 速度线；HUD 显示激活剩余时间与冷却。
   AI 端无需任何处理（它们就是"被减速的世界"）。

## 二、时间减速实现（服务器权威）

### 2.1 核心思路
- Game 维护一个**世界时间缩放** `worldTimeScale`：
  - 无激活：1.0（一切照旧，零开销）；
  - 有真人激活：0.35。
- `game.update()` 拆出两个 dt：
  - `realDt`：按真实时钟推进（比赛计时、施法者移动/射击/换弹/视角）；
  - `worldDt = realDt * worldTimeScale`：其余一切（AI 玩家、子弹、投掷物、
    gas、空投、烟雾、尸体等）。
- **施法者玩家** `update(realDt)`（全速）；**其他所有玩家**（AI）
  `update(worldDt)`（慢动作）。
- 施法者的子弹也按 `worldDt` 减速（还原 2077：世界凝固，子弹飞行也慢，
  但因为敌人同样慢，命中判定相对公平且更好预判）。

### 2.2 改动点（server）
| 位置 | 改动 |
| --- | --- |
| `Game`（game.ts） | 新增 `sandevistanTimeScale()`（读取施法者状态）；`update()` 拆 realDt/worldDt 分发给各子系统 |
| `PlayerBarn.update` | 签名支持 `(worldDt, realDt)`：施法者用 realDt，其余用 worldDt |
| `Player` | 新增 `sandevistanActive/_sandevistanTicker/_sandevistanCooldown`；Use 激活；`recalculateSpeed` 移速 +20%；激活期间散布减半 |
| `WeaponManager` | 施法者 fireDelay/reload 按真实时间走（随玩家 update 自动满足）；散布减半在 fireWeapon 判断 |
| `Gas/Plane/BulletBarn/...` | 统一接收 worldDt（一行改动，全部自动减速） |
| `Player.kill` | 激活期间击杀 → 冷却 -4s |
| `gameServer` | 该模式自动填 AI（已有机制）+ 确保仅 1 真人（若第二真人加入，按普通模式处理或进入观战） |

### 2.3 多施法者防御
- 设计上仅 1 名真人。为防呆：若出现第二个真人激活（或未来开放多真人），
  `worldTimeScale` 取**最慢**的激活者（如 0.35 × 0.35），并且状态同步各自独立；
  v1 仅按"单激活者"实现，多激活取最小值。

## 三、机制参数（v1 原型，集中 GameConfig）

| 参数 | 值 | 说明 |
| --- | --- | --- |
| 世界时间缩放 | 0.35 | 激活期间 worldDt = realDt × 0.35 |
| 持续 | 5.0s | |
| 冷却 | 25.0s | 激活结束开始计 |
| 施法者移速 | +20% | 叠加在基础速度 |
| 施法者散布 | ×0.5 | |
| 击杀减 CD | -4.0s | 激活期间击杀 |
| gas | 减速 | 世界的一部分（可配置：true/false） |

## 四、客户端（阶段2）

- HUD：芯片图标、激活剩余时间、冷却倒计时。
- 全屏蓝色调滤镜 + 速度线（施法者端）。
- 激活/结束音效。
- 世界减速是服务器同步的自然结果（AI 位置/子弹更新变慢），客户端无需
  额外"减速渲染"，只需保证自己的本地预测全速（已有机制）。
- 协议：玩家状态序列化新增 `sandevistanActive` + `sandevistanCooldown`
  （protocolVersion 85 → 86，与 V66 同流程）。

## 五、文件清单（预估）

| 文件 | 改动 |
| --- | --- |
| shared/defs/gameObjects/sandevistanDefs.ts | 新增：芯片物品（type use） |
| shared/defs/gameObjects/gameObjectDefs.ts | 注册 |
| shared/defs/maps/baseDefs.ts（main） | gameConfig 增加 sandevistanMode |
| shared/gameConfig.ts | 参数 + protocolVersion 86 |
| shared/net 状态序列化 | 激活/CD 字段 |
| server/src/config.ts | DefaultModes 注册新模式 |
| server/src/game/game.ts | worldTimeScale + dt 拆分 |
| server/src/game/objects/player.ts | 技能逻辑、发放、击杀减CD、移速 |
| server/src/game/objects/playerBarn.ts | update 双 dt |
| server/src/game/weaponManager.ts | 散布减半 |
| client/src HUD/render | 技能槽、CD、蓝调滤镜 |
| server/src/sandevistanSmokeTest.ts | 新测试 |
| V84_CHANGELOG.md / V84_VALIDATION.md | 文档 |

## 六、测试计划

1. **sandevistanSmokeTest**：
   - 激活后 `worldTimeScale` 变为 0.35，结束恢复 1.0；
   - 施法者 `update` 用 realDt（移速/射速全速），AI 玩家用 worldDt（位置增量减半）；
   - 子弹/投掷物/gas 按 worldDt 推进；
   - 冷却拒绝重复激活；击杀减 CD；
   - 模式开启开局发放芯片；第二激活者取更慢 scale（或 v1 拒绝）。
2. **回归**：`test:v41-suite`、`test:v53-matchmaking`、`test:worker-thread-room`、
   `test:bot-autofill-config`、`test:admin`。
3. **客户端**：构建通过；HUD/滤镜静态检查。

## 七、风险与规避

| 风险 | 规避 |
| --- | --- |
| dt 拆分漏掉子系统导致"部分世界不减速" | 集中改 game.update() 分发；测试断言 bullet/gas/AI 均减速 |
| 施法者 update 双跑副作用 | playerBarn 双 dt 单次 update，不重复调用 |
| 多真人同时激活 | 该模式设计仅 1 真人；防御性取最慢 scale |
| 毒圈减速拖慢对局 | gas 减速可配置（默认减速还原体验，也可关掉保持节奏） |
| 协议升级 | 85→86 同步改，已有先例（V66） |

## 八、实施阶段

- **阶段1**：服务端 timeScale + 技能 + 物品 + 模式注册 + 双 dt 分发 + 测试。
- **阶段2**：客户端 HUD + 蓝调滤镜 + 音效。
- **阶段3**：AI 使用芯片（v2）、掉落变体、平衡调参。