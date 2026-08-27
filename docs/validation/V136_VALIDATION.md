# V136 验证记录：1v1 开局 AI 空袭

## 验证项
1. planBrStrobeBarrage（duel 场景）：
   - 4 信标、无压力、距离 25 → 非反击齐射，barrageCount >= 3 ✅
2. planForbiddenCounterStrobes（openingBarrage 参数）：
   - 默认（无参数）5 信标 → 0（不主动开火）✅
   - openingBarrage=true、2 信标 → 0（信标不够）✅
   - openingBarrage=true、6 信标 → 3 + 保留 3 + carpet ✅
   - 压力反击（6, 2）→ 3（旧行为不变）✅
3. 回归：tsc / forbidden-ai / forbidden-context / duel / bot-brain /
   bot-input / movement-jitter 全部 PASS ✅
4. 开发环境：热重载正常，8001/3000 在线，api 200 ✅

## 结论
- 1v1 开局（回合前 4 秒）AI 信标 ≥3 时立即向玩家引导空袭齐射；
- 全难度生效（普通/困难/Pro 走常规齐射，LEGIT/HACKER 走 forbidden 开局齐射）；
- 可在 1v1 房间把 AI 投掷物信标配到 3+ 后进对局验证。