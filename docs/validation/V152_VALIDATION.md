# V152 验证记录：搜打撤模式完善

## 功能验证

1. 小地图只显示开启的撤离点：
   - 静态 5 点已移除，动态标记仅渲染当前离玩家最远的开启点 ✓
   - 非搜打撤模式不渲染任何撤离点标记 ✓
2. 删除毒圈：
   - 服务端主循环跳过 `gas.update()`，毒圈永不收缩/伤害 ✓
   - 集成测试断言 `gas.stage` 与 `currentRad` 在多次 `game.update()` 后不变 ✓
3. AI 阵亡补充：
   - 4 秒轮询 + 每房冷却，缺口 > 0 时补 1 个 serverBot ✓
   - 出生点与任何真人距离 ≥ 120（500 次重试上限）✓
4. 10 分钟时限：
   - `startedTime >= 600` 后一次性击杀全部存活玩家 ✓
   - 集成测试断言 `TimeUp` 击杀后 `bot.dead === true` ✓
   - 修复 `timeup`/`extraction` 未注册类型导致 KillMsg 序列化崩溃的问题 ✓

## 回归

- server tsc：PASS
- client tsc + vite build：PASS
- test:extraction（含新增断言）：PASS
- test:loot-fire-fix / test:cooperation / test:bot-brain / test:all-modes /
  test:admin / test:v50-room-targets：全部 PASS

## 结论

- 搜打撤模式地图仅标记开启撤离点，无毒圈；
- AI 阵亡后自动补充且不出现在玩家视野中；
- 对局 10 分钟到点全员阵亡，击杀播报正常。
