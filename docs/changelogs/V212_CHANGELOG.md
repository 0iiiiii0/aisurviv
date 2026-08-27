# V212 修复重连重复扣仓

## 问题

断线重连复用旧 Player 后，加入流程仍再次调用
`applyExtractionSpawnLoadout()` → 重复执行 `grantLoadout()`：
重复扣仓库，并覆盖局内战利品。

## 修复

### server/src/game/game.ts
- `applyExtractionSpawnLoadout()` 开头检查
  `player.extractionLoadoutGranted`：已发放过（重连复用）直接返回，
  只首次加入发放一次。

### server/src/game/objects/player.ts
- Player 新增 `extractionLoadoutGranted = false` 标记
  （生命周期内一次；被移除重建后自然重置）。

## 验证

- 集成测试：首次发放扣仓（库存变化）、模拟重连再次发放
  **库存不变**、标记置位 ✓
- server tsc / test:extraction（新增断言）/ test:admin：PASS
