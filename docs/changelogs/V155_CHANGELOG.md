# V155 搜打撤：击杀全部人后不弹胜利（含双人/四人）

## 需求

搜打撤模式下不要在击杀全部人后弹出胜利；对局只通过撤离或
10 分钟时限结束（AI 阵亡后由补员机制继续补充）。

## 实现

### 服务端（server/src/game/gameModeManager.ts）
- `handleGameEnd()` 增加搜打撤特判（位于组队/单人胜利分支之前）：
  - 存活数 > 0（含只剩 1 人/1 队）：返回 false——不弹胜利、对局继续；
  - 存活数 == 0（时间到/最后一人撤离或阵亡后的空场）：返回 true——
    房间正常关闭，但**不产生胜利者**。
- 普通模式（单人/双人/四人/50v50）的胜利判定保持不变。

### 补员联动（server/src/gameServer.ts）
- `tickExtractionReplenish` 增加 `game.over` 检查，房间已结束后不再补 AI。

### 数据通道（gameManager.ts / gameProcessManager.ts / game.ts）
- `GameData` 增加可选 `over` 字段并随 `updateData` 上报，
  后台/补员循环可感知对局已结束。

## 验证

- `test:extraction` 新增团队集成测试（TeamMode.Duo / TeamMode.Squad）：
  - 消灭敌方组后 `over` 不变（不弹胜利）✓
  - 消灭所有组后空场关闭房间、无胜利者 ✓
  - 单人模式：仅剩 1 人时 `checkGameOver` 不置 over ✓
- server tsc / `test:all-modes` / `test:admin`：PASS
