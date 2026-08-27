# V216 修复倒地/断线/未开局也能累计撤离进度

## 问题

撤离进度循环只跳过 AI 与观察者；倒地、断线、未开局的玩家站圈
也会累计进度并撤离。

## 修复（server/src/game/extractionSystem.ts）

玩家循环新增守卫：
- `!game.started` → 未开局不累计；
- `player.downed` → 倒地不累计；
- `player.disconnected` → 断线不累计。

## 验证

- 集成测试：倒地玩家站圈 5 秒不撤离 ✓
- server tsc / test:extraction（新增断言）：PASS
