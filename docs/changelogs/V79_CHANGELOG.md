# V79 修复风行（Windwalk）音效重复

## 玩家反馈

- 风行（Windwalk）音效有重复/叠加播放的问题。

## 根因

- `windwalk` 天赋的触发机制：**每一颗**经过玩家 5 单位内的敌方子弹
  （`bullet.ts`）以及每次附近爆炸（`explosion.ts`）都会调用
  `giveHaste(Windwalk, 4)`。
- 服务端 `giveHaste()` 每次调用都 `hasteSeq++`；客户端在 `hasteSeq` 变化时
  **重播** `ability_stim_01` 音效并**重启**风粒子发射器。
- 结果：被连续射击/爆炸时，风行音效跟着每一颗子弹反复播放、叠加，粒子也
  反复闪烁。

## 修复（server/src/game/objects/player.ts）

- `giveHaste()` 增加同类型刷新保护：当 `hasteType` 相同且 `_hasteTicker > 0`
  （该加速仍在生效）时，只刷新剩余时长、**不再递增 hasteSeq**。
- 效果：
  - 首次触发风行 → 播放一次音效/粒子；
  - 持续被射击/爆炸 → 只静默续时长，不再重播音效；
  - 加速自然结束后再次触发 → 正常重新播放一次；
  - 切换到其他加速类型（Takedown/Inspire 等）→ 正常播放。

## 测试

- 新增 `test:haste-sound`：
  - 首次 Windwalk → `hasteSeq` 递增；
  - 连续两次刷新 Windwalk → `hasteSeq` 不变、时长被刷新；
  - 切换 Takedown → `hasteSeq` 递增；
  - 加速过期后重新触发 Windwalk → 递增一次；
  - 源码断言：`giveHaste` 刷新保护、windwalk 由子弹/爆炸触发。
- `test:v41-suite`（11 项）及 V53–V78 全部回归 PASS；服务端构建 PASS。