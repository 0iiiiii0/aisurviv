# V69 50v50 unified attack orders + human-first rescue

## 需求

1. 50v50 要有统一的进攻指令，不要各自为战。
2. 全模式下，AI 在真人队友倒地且没有直接威胁时优先救援真人玩家。

## 根因

1. **各自为战**：faction 订单虽然是全队共享的，但每个兵种（vanguard/flank/
   fire-support/reserve…）拿到的是**不同车道**的独立目标；集火目标（focusTargetId）
   只给 +46 分加成，无法压过就近敌人，导致 bot 分散打不同的敌人。
2. **救援不看真人/机器人**：队伍/faction 的倒地报告里没有"是否真人"的信息，
   救援分配按距离/危险排序，真人队友可能被排在 bot 后面。

## 实现

### 统一进攻指令（server/src/bot/factionStrategy.ts + smartBot.ts）
- `FactionOrder` 新增 `unifiedPush` 标志：当阵营健康（pressure<0.5、伤亡<0.42、
  存活≥4、非 final、非撤退/救援）时，全队进入统一冲锋：
  - 车道侧移收敛到原来的 32%（各兵种围绕同一前点而不是撒开）；
  - reserve 改为攻击姿态前压、fire-support/marksman/medic 前移；
  - 侵略性下限抬到 0.62、队形间距收紧 18%。
- `chooseEnemy` 集火强化：faction 订单处于 attack 且 `focusTargetId` 有效时，
  该目标额外 +92 分（合计 +138），整个小队集中火力打同一个敌人。
- 把 `getFactionOrder` 提前到 `chooseEnemy` 之前执行，确保集火目标用最新指令。

### 优先救援真人（shared/net/updateMsg.ts + smartBot.ts + factionStrategy.ts）
- `PlayerInfo` 新增 `isBot` 字段（服务端 Player 通过 `get isBot()` 提供），
  协议版本 83→84→85（沿用 V67 的版本线）。
- 倒地报告 `DownedReport` / `FactionDownedReport` 新增 `human`；
  `findDownedTeammates` 用 `playerInfos.isBot === false` 判定真人。
- 小队救援 `computeRescueAssignments`：真人目标排序 +160，优先分配。
- faction `rescueAssignment`：候选按 `human` 排序，真人先救。
- 救援意图：真人救援 tier 提升（support+0.6）且 utility +150，
  reason="revive-human-teammate"。
- 客户端 `setPlayerInfo`/`getPlayerInfo` 补齐 `isBot`（构建通过）。

## 测试

- 新增 `test:cooperation`：
  - `PlayerInfo.isBot` 协议往返（真人 false / 机器人 true）；
  - 健康进攻阵营全员 `unifiedPush=true`、队形收敛（最大间距 <80）；
  - 高压（敌人贴脸）时 `unifiedPush=false`；
  - faction 救援在"真人与 bot 同时倒地"时选真人；
  - 源码断言：human 标志、救援排序、集火加成、指令先行、unifiedPush。
- 客户端/服务端构建通过；`test:v41-suite`（11 项）及 V53–V68 相关回归全过。
- 真实 faction 对局（16 bot、180s）正常：bot 按共享 bridgehead 指令行动，无回归。