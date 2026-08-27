# V162 验证记录：常规模式 Create Team

## 验证

1. Create Team 默认创建 main duo（gameModeIdx=1），未公开模式可用 ✓
2. 切换 main squad（未公开）成功 ✓
3. playGame 放行未公开模式，返回 joinGame + gameId ✓
4. 公开随机匹配仍要求 enabled（findGame 对非 teamRoom 请求不变）✓
5. faction / extraction / sandevistan 不混入常规队伍模式 ✓
6. 构建与回归：server tsc、client build、
   test:admin / test:extraction PASS ✓

## 结论

- 常规模式 Create Team 恢复可用：创建 Normal 双人/四人邀请队伍，
  可正常开始对局；
- 公开匹配的开关语义不受影响。
