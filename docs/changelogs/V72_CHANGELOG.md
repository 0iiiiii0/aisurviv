# V72 烟雾单向视野对抗：被烟雾内敌人射击时的应对

## 需求

- 真人玩家躲进烟雾即可利用单向视野击杀 AI（AI 看不到烟雾里的人，里面的人能
  看到 AI），需要优化 AI 的烟雾处理。

## 根因

- 现有 `ConcealmentTracker` 只有在**看到敌人进烟**时才生成烟雾接触（hidden
  contact），随后 `engageHiddenArea` 会让 AI 退到 1x 视野环外再压制/扔雷——这条
  路径本身是防单向视野的。
- 缺口：**敌人进烟时 AI 没看见**（转头/敌人丢烟自进/原在烟里）→ 没有接触 →
  AI 站在开阔地朝烟雾盲射/发呆，被烟里的人白打。

## 实现

### 1. 弹道威胁 → 烟雾接触桥接（server/src/smartBot.ts）
- 新增 `bridgeBallisticThreatToSmokeContact`：当高置信度（≥0.5）的弹道推断射手
  位置落在某个烟雾区（半径+1.5 内）时，把该玩家注入为烟雾接触
  （`injectSmokeContact`），立即触发既有 `engageHiddenArea` 单视野应对：
  撤离到 1x 视野安全环外、从掩体后压制/扔雷、绝不进烟。
- 连续射击会刷新接触（置信度回升、到期时间延长），火力一停接触按烟雾衰减。
- 记录 `smoke_ambush_bridged` 事件供回放分析。

### 2. 追踪器（server/src/bot/concealmentIntelligence.ts）
- `ConcealmentTracker.injectSmokeContact`：注入/刷新烟雾接触。
- `hasContactInZone(zoneKey)`：查询某隐蔽区是否有关联接触（供移动回避用）。

### 3. 移动级烟雾回避（server/src/smartBot.ts）
- 新增 `smokeDangerAvoidance`：在 `moveDirection` 中对**含接触或正在被射击**的
  烟雾区施加斥力（半径+15 内，越近推力越大），避免 bot 在搜索/移动时误闯
  可能藏敌的烟雾；干净烟雾（无接触、无来火）不影响移动。

## 测试

- 新增 `test:smoke-handling`：
  - 单向视野模型：烟外看不到烟内（AI 视角）、烟内能看到烟外（真人视角）、
    同在烟内互相可见；
  - `injectSmokeContact` 生成 smoke 接触（置信度≥0.5 可触发应对）；
  - 连续射击刷新接触（到期延长）；
  - 源码断言：桥接接线、`smoke_ambush_bridged` 录制、`smokeDangerAvoidance`
    仅对含接触/来火的烟生效、追踪器两个新方法。
- `test:v41-suite`（11 项）及 V53–V71 全部回归 PASS。

## 实测（main、16 bot、240s）

- 无回归；隐蔽应对机制在 bush/roof 上实测生效（`concealment_fire_burst` 在
  距目标 31 单位的安全环外压制）；本局无烟雾出现（纯 AI 对局 bot 很少用烟），
  烟雾桥接场景为人类玩家专属，逻辑已由确定性单测全覆盖。