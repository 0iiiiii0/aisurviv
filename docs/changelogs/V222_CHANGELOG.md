# V222 降低 AI 内存占用（高性能 AI 除外）

## 需求
- 降低普通 AI（普通 / 困难 / Pro）的内存占用；
- 高性能 AI（LEGIT / HACKER）保持原有独立数据与行为，不受影响。

## 现状与根因

每个 `TacticalBot` 都维护一个独立的 `MapNavigator`。收到地图消息时，
`MapNavigator.load()` 会**深拷贝整份地图快照**（上千个静态对象 +
rivers/places/groundPatches），并**重新运行对象分类**（buildings/bunkers/
bridges/containers/covers/hazards/vegetation/highValue/tacticalPoints 等）。

在 100 人的 50v50 中，同局的 100 个 bot 持有的是**完全相同的 100 份地图
快照和 100 份分类结果**，这是 AI 内存的主要冗余来源。

## 实现

### server/src/bot/mapStrategy.ts
- 新增进程内只读缓存 `SHARED_MAP_ANALYSES`，键为 `(mapName, seed)`：
  - 普通 AI 加载地图时命中缓存则直接复用 `snapshot / data / profile`，
    不再深拷贝、不再重复分类；
  - 未命中时按原逻辑构建一次并写入缓存；
  - 缓存上限 8 条（简单 LRU 逐出最旧条目），防止不同 seed 的对局无限累积；
- `snapshot / data / profile` 加载后均为只读（已核实无任何原地修改），
  每 bot 的 `visitedCells`、`routeWaypoint` 等导航记忆仍保持独立。

### server/src/smartBot.ts
- `TacticalBot` 构造函数中根据难度设置
  `mapNavigator.useSharedAnalysis`：
  - `normal / hard / pro`：开启共享（降低内存）；
  - `legit / forbidden`（LEGIT / HACKER）：关闭共享，保持独立副本，
    与改动前完全一致，避免高性能 AI 的行为与共享缓存耦合。

## 验证

- 新增 `test:map-memory-sharing`（server/src/mapMemorySharingSmokeTest.ts）：
  - 同 (mapName, seed) 的普通 AI 共享同一地图快照；
  - 不同 seed 之间不共享；
  - 高性能 AI 保持独立副本且分类结果与共享版一致；
  - 超过 LRU 上限后最旧条目被逐出、缓存有界；
- server `tsc --noEmit`：PASS；
- `test:bot-brain`、`test:bot-input`、`test:forbidden-context`、
  `test:perk-role-wander`、`test:cooperation`：PASS。

> 说明：共享的数据与独立构建的数据内容完全一致（同一深拷贝/分类逻辑），
> 仅引用共享，不改变 AI 的行为。
