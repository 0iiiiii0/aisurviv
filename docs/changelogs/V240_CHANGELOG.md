# V240 绝密模式：撤离点前 5 分钟关闭

## 需求
- 绝密模式下，撤离点在对局**前 5 分钟关闭**（无法撤离），5 分钟后开放。

## 实现

### 服务端
- `shared/defs/extractionDefs.ts`：新增 `EXTRACTION_SECRET_OPEN_SECONDS = 300`；
- `game/extractionSystem.ts`：绝密模式且对局进行 < 300 秒时，站进撤离点
  **不累计撤离进度、不触发撤离**（`holdSeconds` 清零并跳过）；满 5 分钟恢复。

### 客户端（main.ts / game.ts）
- `main.ts`：siteInfo 加载后把绝密开关写入 `window.survivExtractionSecret`；
- `game.ts`：绝密模式且剩余时间 > 5 分钟时，**隐藏撤离点标记**，
  并在 HUD 显示「撤离点未开放 · MM:SS 后开放」；5 分钟后恢复显示撤离点。

## 验证
- `test:extraction-secret` 新增断言：绝密模式对局进行 100 秒时站撤离点
  反复 5 秒**不撤离**；进行 301 秒后站撤离点 5 秒**正常撤离**；
- server / client `tsc` + build：PASS。
