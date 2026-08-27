# V136 1v1 开局空袭：AI 信标足够时开局即向玩家发起空袭

## 需求
- 1v1 对局中，当 AI 拥有足够信标（IR Strobe）时，应该在**开局**就向玩家
  发起空袭，而不是等到被轰炸后才反击。

## 实现

### 1. 普通/困难/Pro（常规决策流）
- `server/src/bot/brStrobeBarrage.ts`：`planBrStrobeBarrage` 移除
  `duelMode` 门槛——1v1 与吃鸡共用同一套规则：
  - 信标 ≥3 个且敌人可见、距离 14~40 → 开局立即连扔 3~5 个（间隔 ~420ms）；
  - 被轰炸中（≥2 个敌方空袭区）→ 立即反击 1~3 个（间隔 ~360ms）。
- `server/src/smartBot.ts`：
  - `tryBrStrobeBarrage` 移除决斗模式早退；
  - 决策候选移除 `!duelModeActive` 门槛——1v1 开局敌人一进入射程就会
    触发信标齐射（legit/hacker 走独立的 forbidden 流，不会重复触发）。

### 2. LEGIT/HACKER（forbidden 决策流）
- `server/src/bot/forbiddenCombat.ts`：`planForbiddenCounterStrobes` 新增
  第 4 参数 `openingBarrage`——信标 ≥3 且开局时立即承诺 3 个信标的短齐射
  （保留其余）；默认仍是"只有压力/战术机会才用"。
- `server/src/smartBot.ts`：
  - 新增 `duelRoundStartedAt` / `duelOpeningStrobeArmedForRound`，在
    ArenaRound 进入 Playing 时记录回合开始时间；
  - `tryForbiddenTacticalStrobeCounter`：回合开始 4 秒内、信标 ≥3、
    且本回合未开火 → 以 `openingBarrage` 模式武装齐射（每回合最多一次）；
  - 录像事件 `airstrike_counter_armed` 增加 `openingBarrage` 字段。

## 验证
- `test:br-strobe`（新增断言）：
  - 决斗开局：4 信标 → 非反击模式齐射 ≥3；
  - `planForbiddenCounterStrobes`：默认不开局齐射；2 信标开局 → 0；
    6 信标开局 → 3 个 + 保留 3；压力反击行为不变。
- 回归：server tsc、test:forbidden-ai、test:forbidden-context、
  test:duel、test:bot-brain、test:bot-input、test:movement-jitter 全部 PASS。
- 开发服务器已热重载并正常（8001/3000，api 200）。

## 效果
- 1v1 中只要给 AI 配置 ≥3 个信标，回合开始后 AI 会在前几秒连续引导
  空袭压制玩家；被玩家先手轰炸时仍会立刻反击。