# AI Match Recording Analysis V23

分析来源：用户回传的 `ai-match-recordings.7z`。

## 数据范围

- 记录会话：10
- AI 实例：68
- 记录格式：AI Match Recorder v1
- 默认行为帧采样：500 ms
- 地图类型：main、duel、faction

## 主要发现

### 1. 意图切换过于频繁

- `intent_changed`：12,312 次
- 其中 9,406 次（76.4%）在 500 ms 内再次切换
- 常见表现为寻枪、打箱子、空意图之间反复跳变
- 空意图出现时有 2,916 次处于 `gas` 状态

这会造成 AI 犹豫、左右晃动、放弃正在接近的资源，以及战斗准备被打断。

### 2. 未来安全圈边界发生状态抖动

- gas 状态片段：3,192 段
- 中位持续时间：167 ms
- 91.6% 的片段短于 500 ms
- 高频状态切换：
  - loot → gas：1,820 次
  - gas → loot：1,795 次
  - break-crate → gas：849 次
  - gas → break-crate：837 次

根因是 AI 位于未来安全圈判断边界附近时，每个思考帧都会重新进入或退出预撤离状态。

### 3. 遮蔽物战术能识别目标，但投掷物没有真正执行

- `hidden_contact_selected`：36 次
- 屋顶/建筑区域：32 次
- 灌木：4 次
- `concealment_fire_burst`：11 次
- `concealment_grenade_queued`：0 次

日志中出现 AI 携带 MIRV 并选择 `throw-grenade`，但下一帧退化为打灌木或盲射。原安全站位通常位于隐藏区域安全环的外沿，使目标距离超过约 39 单位的有效投掷范围。

### 4. 后续记录缺少路径恢复原因

现有记录可以看到 AI 停留或反复移动，但无法准确区分：

- 主动近战攻击箱子
- 门口被阻挡
- 寻路目标失效
- 真正卡住并触发恢复

因此本版新增路径恢复事件，而没有依据不完整数据直接大幅修改所有卡住判定。

## V23 修改

### 毒圈决策迟滞

- 增加预撤离状态锁存器。
- 触发未来圈撤离后，默认至少保持 1.8 秒。
- 使用不同的进入和退出安全边界，避免边界来回切换。
- 最终缩圈阶段采用更短但仍稳定的保持时间。
- 记录 `gas_escape_started`、`gas_escape_ended` 和每帧 `gasDecision`。

### 遮蔽物投掷站位

- 携带 Frag/MIRV 且适合投掷时，安全站位限制在安全环内沿。
- 投掷目标依次尝试：入口预测点、最后预测位置、区域中心。
- 只选择距离 15–38.5 单位的可投掷目标。
- 仍保留自身爆炸、队友、障碍物和实际瞄准方向检查。
- 队列失败时记录 `concealment_grenade_blocked`，包含距离、武器和失败原因。

### 路径恢复遥测

新增 `path_recovery_triggered` 事件，记录：

- 恢复等级及是否重复触发
- 当前状态和意图
- 原目标、恢复目标和坐标
- 是否在室内
- 当前资源箱、战利品和房门目标

## 验证

- 服务端 TypeScript 编译通过
- 客户端 TypeScript 类型检查通过
- 服务端 Smoke Test：35/35 通过
- 毒圈边界迟滞测试通过
- 遮蔽物投掷范围测试通过
- AI 对局记录器测试通过

## 下一批记录重点

优先检查以下事件：

- `gas_escape_started`
- `gas_escape_ended`
- `concealment_grenade_queued`
- `concealment_grenade_blocked`
- `throw_released`
- `path_recovery_triggered`

建议至少包含：

1. 一场普通单人局；
2. 一场 50v50；
3. 一场包含建筑、厕所、集装箱或烟雾交战的局；
4. 一场进入后期毒圈的完整对局。
