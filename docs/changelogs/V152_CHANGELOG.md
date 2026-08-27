# V152 搜打撤模式完善：动态撤离点地图 / 删除毒圈 / AI 阵亡补充 / 10 分钟时限

## 需求

1. 地图只显示开启的撤离点（其余隐藏）；
2. 删除毒圈；
3. 对局中 AI 阵亡后系统自动补充（不补在玩家视野里）；
4. 整局限时 10 分钟，超过 10 分钟默认全部死亡。

## 实现

### ① 小地图只显示开启的撤离点（client/src/map.ts + client/src/ui/ui.ts）
- 移除小地图静态绘制的全部 5 个撤离点标记，及不再使用的
  `generateExtractionPoints` 引用；
- 新增 `updateExtractionMapSprite()`：非搜打撤模式释放标记；搜打撤模式下
  每次更新重新计算**当前开启（离玩家最远）**的撤离点，用 MapSpriteBarn 的
  绿色（0x22dd55）脉冲圆点渲染，`zOrder = 65535 * 3` 保证置顶；
- 世界中已有的绿色脉冲光柱与站圈倒计时 HUD 保持不变。

### ② 删除毒圈（server/src/game/game.ts）
- 主循环 `gas.update()` 仅对非搜打撤模式执行：
  `if (!this.map.mapDef.gameMode.extractionMode) this.gas.update(worldDt);`
- 服务端毒圈永不收缩、永不造成伤害；安全区始终为全图。

### ③ AI 阵亡后自动补充（server/src/gameServer.ts + server/src/game/map.ts）
- `gameServer.ts` 新增 `extractionReplenishAt` 冷却表与
  `tickExtractionReplenish()`（4 秒间隔，`unref`），只对搜打撤、非纯 AI、
  有真人的未停止房间生效；按统一补齐策略（
  `getBotAutoFillPolicy`）计算缺口，缺口 > 0 且冷却结束时补 1 个 AI；
- `spawnReplacementExtractionBot()`：用 `createJoinToken(..., serverBot=true)`
  生成服务器机器人令牌后调用 `spawnGameBot` 入局；
- `map.ts` 新增 `extractionSpawnNearHuman()`：补员 AI 的出生点与任何非 bot
  真人保持至少 120 距离，`getRandomSpawnPos` 重试（500 次上限），避免补在
  玩家视野里。

### ④ 整局限时 10 分钟（shared/gameConfig.ts + server/src/game/extractionSystem.ts + client/src/ui/ui2.ts）
- `DamageType` 枚举新增 `TimeUp`；
- `ExtractionSystem.update()` 开头检测：对局开始且 `startedTime >= 600`
  时一次性击杀所有存活玩家（`damageType: TimeUp`），对局结束；
- 修复击杀广播序列化问题：`TimeUp`/`Extraction` 不再传未注册的
  `gameSourceType`（原 `"timeup"`/`"extraction"` 不在物品类型表，会导致
  KillMsg 序列化断言崩溃），客户端击杀播报仅依赖 `damageType`；
- `getKillFeedText` 新增 `DamageType.TimeUp` 播报「时间到，全员阵亡」。

## 验证

- server `tsc`：PASS
- client `tsc --noEmit && vite build`：PASS
- `test:extraction`（新增毒圈不推进、时间到全员阵亡断言）：PASS
- `test:loot-fire-fix` / `test:cooperation` / `test:bot-brain` /
  `test:all-modes` / `test:admin` / `test:v50-room-targets`：全部 PASS
