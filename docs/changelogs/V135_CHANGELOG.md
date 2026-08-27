# V135 AI 地毯式轰炸平衡：真人信标节流 + AI 大量信标快速反击

## 需求
- 真人携带大量空袭信标（IR Strobe）时，可以快速连续扔信标实现地毯式轰炸，
  轻松消灭 AI 获胜；
- 反过来，AI 拥有大量信标时也应能快速地毯式轰炸玩家（公平对战）。

## 现状分析
- 此前 AI 只有 1v1 决斗模式（legit/hacker 难度）会使用信标反击
  （tryForbiddenTacticalStrobeCounter 有 `duelModeActive` 门槛）；
- 普通大逃杀模式中，任何难度的 AI 都不会主动扔信标；
- 服务端对真人扔信标没有任何频率/数量限制。

## 实现

### 1. AI 大逃杀信标轰炸（全难度）
- 新增 `server/src/bot/brStrobeBarrage.ts` 纯决策模块 `planBrStrobeBarrage`：
  - **主动地毯**：信标 ≥3 个且敌人可见、距离 14~40 → 连扔 3~5 个（保留少量）；
  - **反击**：被轰炸中（检测到 ≥2 个敌方空袭区）即使只有 1 个信标也立即
    回扔 1~3 个，投掷间隔 360ms；
  - 门槛：刚受伤 400ms 内不打、换弹/打药中不打、决斗模式不接管。
- `server/src/smartBot.ts`：
  - 新增 `"strobe-barrage"` 决策意图（decisionBrain.ts 同步注册）；
  - `tryBrStrobeBarrage()`：预测敌人 2.1 秒后的位置（对应 2.5s 引导 + 航弹
    落点），复用 `solveForbiddenStrobeThrow` 精确解算投掷，360~420ms 连投；
  - 所有难度的大逃杀模式生效；录像记录 `br_strobe_barrage_armed` 事件。

### 2. 真人信标节流（服务端）
- `server/src/game/objects/projectile.ts`：
  - 人类玩家每 **2.8 秒最多引导一次空袭**（`STROBE_STRIKE_COOLDOWN_MS`）；
  - 冷却期间再扔的信标会被消耗但不会召唤空袭（防止无限地毯）；
  - **服务器机器人豁免**——AI 不受限制，可以快速连扔反击。
- `server/src/game/objects/player.ts`：新增 `strobeStrikeLockedUntil` 字段。

## 验证
- 新增 `server/src/brStrobeBarrageSmokeTest.ts`（`npm run test:br-strobe`）：
  - 纯决策门槛 8 组断言（无信标/少量/大量/反击/距离/受伤/决斗）；
  - 服务端节流：人类第 2 个信标不产生空袭（只产生第一个的 3 条航线）、
    AI 信标不受限、锁过期后恢复；
- 回归：server tsc、test:airstrike-safety、test:forbidden-ai、
  test:forbidden-context、test:duel、test:bot-brain、test:bot-input、
  test:movement-jitter、test:v33-aim-brokenarrow 全部 PASS。

## 备注
- 录像中的空袭相关事件（airstrike_warning_observed / br_strobe_barrage_armed /
  throw_released）可用于复查 AI 轰炸与躲避表现。