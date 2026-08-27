# V233 修复非内存炸服：writeFloat 超界导致 uncaughtException 崩溃

## 问题
- 服务器反复炸服（server-crash.log 出现多次 `process-exit-1`）：
  ```
  Error: writeFloat: value out of range: 60.02977889283055, range: [0, 60]
      at UpdateMsg.serialize (updateMsg.ts:490)
      at Player.sendMsgs ... Game.netSync ... NanoTimer
  ```
- 根因：空袭区（airstrike zone）的 `duration` 字段略超协议上限
  （`AirstrikeZoneMaxDuration = 60`）——飞机离目标很远时
  `impactIn + 2.8` 超过 60（浮点累计误差 60.03）。`BitStream.writeFloat`
  对超界值直接 `assert` 抛异常 → uncaughtException → 服务器进程崩溃。

## 实现

### shared/net/net.ts（根治）
- `writeFloat` 改为**容错 clamp**：值先 clamp 到 `[min, max]` 再写入，
  非有限值（NaN/Infinity）按 min 处理；协议序列化绝不因边界/浮点误差
  让整个服务器进程崩溃。

### server/src/game/objects/player.ts（源头）
- 两处空袭区 `duration` 计算（飞机到达预测 + strobe 警告）都
  clamp 到 `AirstrikeZoneMaxDuration`（60），不再产生超长空袭警告。

## 验证
- 新增 `test:net-float-clamp`：60.03 / 150 / -5 / NaN 均被 clamp、不崩溃，
  读回值落在范围内（8-bit 量化容差）；
- `test:v53-matchmaking-recovery`、`test:extraction`：PASS；
- server / client `tsc` + build：PASS（`dist` 已更新，shared 哈希变化）。
