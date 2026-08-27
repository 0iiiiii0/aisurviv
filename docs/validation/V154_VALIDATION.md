# V154 验证记录：对局剩余时间倒计时

## 验证

1. 协议：MatchTimeMsg 序列化/反序列化往返一致 ✓
2. 服务端：开局后约 1 秒广播一次 MatchTime ✓
3. 客户端：收到后显示 `MM:SS` 倒计时，最后 60 秒变红 ✓
4. 边界：非搜打撤 / 未开局 / 观战不显示；剩余时间不小于 0 ✓
5. 构建：server tsc、client tsc + vite build PASS ✓
6. 回归：test:extraction（新增断言）、test:admin、test:all-modes PASS ✓

## 结论

- 玩家在小地图上方可以看到搜打撤对局的 10 分钟倒计时；
- 时间到全员阵亡的判定与客户端倒计时使用同一共享常量（600 秒）。
