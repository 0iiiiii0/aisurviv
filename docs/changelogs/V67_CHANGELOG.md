# V67 AI opens button doors and password (puzzle) doors; search-phase fixes

## 需求

- 让 AI 学会开启所有类型的资源，包括按钮门（vault/cell/crossing 控制面板）和
  密码按钮门（Eye / Chrysanthemum / Saloon / Club 拼图序列）。
- 排查并优化 AI 搜索阶段的问题。

## 搜索阶段发现的问题

1. **密码按钮门从未被使用**：拼图按钮（`control_panel_02b`、`switch_01` 等带
   `puzzlePiece` 的按钮）不满足旧的 `isVaultControlPanel` 判定（`useType` 为空），
   AI 从不按密码顺序，地下 vault/lab/secret 门全部打不开。
2. **按钮门只对无枪 AI 开放**：`chooseVaultPanel` 要求 `usableGunCount() === 0`，
   已持枪的 AI 不会去开 cell/crossing 按钮门。
3. **拼图按钮的标签不在协议里**：客户端/机器人收不到每个按钮属于密码序列的哪一位
   （egg/ichi/red…），因此无法按正确顺序按压。
4. **探索不识别谜题建筑**：搜索逻辑偏向“bunker/vault”模式，但地下谜题楼层依赖
   机器人路过对应按钮才会触发（本轮保留为机会式触发）。

## 实现

### 协议（shared）
- `objectSerializeFns` 障碍物 full 数据新增 `puzzlePiece` 字符串：拼图按钮把自己的
  标签（如 `"egg"`、`"ichi"`）下发给机器人。
- `GameConfig.protocolVersion` 83 → 84。

### 搜索逻辑（server/src/bot/integratedLogicSpec.ts）
- 新增 `PUZZLE_ORDERS`（与 `shared/defs/puzzles.ts` 一致的五套密码顺序）与
  `inferPuzzleOrder()`：按建筑内可见按钮标签集合推断完整顺序；最长匹配优先
  （四键 club_01 优先于单键 club_02），纯诱饵按钮不会触发。

### 机器人求解器（server/src/smartBot.ts）
- 新增 `choosePuzzleTarget()`：按楼层（`myLayer()`）扫描 `isPuzzlePiece` 按钮，
  分组到 `parentBuildingId`，推断顺序，评分选择目标（无枪/缺装备高优先，
  全副武装只顺路）。
- 新增 `continuePuzzle()` 状态机：走到下一个顺序按钮 → `Interact` 按压 →
  步进；读取建筑的 `puzzleErrSeq` 检测按错并从头重试；门打开或超时退出。
- 意图系统新增 `puzzle` 候选（无枪段 400×vaultPanel 权重，常态段 260）与
  `case "puzzle"` 处理。
- `chooseVaultPanel()` 增加 `allowArmed`：持枪 AI 也能以较低优先级去开按钮门
  （常态段新增 `normalVaultPanel` → "open-button-door"）。

## 测试

- 新增 `test:puzzle-door`：
  - `inferPuzzleOrder` 五套顺序/诱饵/歧义判定；
  - 协议往返：`puzzlePiece`/`parentBuildingId` 序列化后仍可读；
  - 服务端机制：Eye 碉堡按 `egg,hydra,storm,conch,crossing,hatchet` 顺序按压后
    `vault_door_eye` 在 completeUseDelay 后打开；
  - 源码断言：求解器方法、armed 按钮门调用、`puzzle` 意图、协议版本 84。
- 客户端 `npm run build` 通过（共享序列化新增字段向后兼容）。