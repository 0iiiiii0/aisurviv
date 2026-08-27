# V211 验证记录：邀请组队模式正确

## 验证

1. extraction duo 索引 39 被保留 ✓
2. 普通 Create Team 仍回退 main duo ✓
3. extraction 进入 enabledGameModeIdxs（可在房间内切换）✓
4. 构建与回归：server tsc、test:admin / all-modes PASS ✓

## 结论

- 搜打撤邀请组队进入搜打撤双人，不再误入 Main Duo。
