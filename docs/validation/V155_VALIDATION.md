# V155 验证记录：击杀全部人不弹胜利（双人/四人）

## 验证

1. 单人（Solo）：仅剩最后一名存活者时不触发胜利 ✓
2. 双人（Duo）：消灭敌方组后 `aliveCount==1` 不结束、不弹胜利；
   空场（0 组）时房间关闭但无胜利者 ✓
3. 四人（Squad）：同上 ✓
4. 普通模式胜利判定未受影响（test:all-modes 覆盖 solo/duo/squad/faction）✓
5. 补员循环在 `over` 后停止 ✓
6. 构建：server tsc PASS；回归 test:all-modes / test:admin PASS ✓

## 结论

- 搜打撤单人/双人/四人模式下击杀全部人后均不会弹出胜利；
- 对局继续（AI 补员），直到玩家撤离或 10 分钟时限全员阵亡后房间关闭。
