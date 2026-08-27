# V137 验证记录：1v1 开局空袭齐射修复

## 录像证据（最新 1v1 legit 录像）
- airstrike_counter_armed ×5（count=10 / barrageCount=3 / openingBarrage=true）
- throw_released(strobe) 仅 1 次，且发生在第 58 秒
- 开局 2.2s combat 窗口内 0 次 special_action_queued
- 开局敌人距离 ~105 码（帧数据 environment 无敌方、target=null）

## 修复验证
1. planForbiddenStrobeCarpet 远敌 + openingBarrage：
   - 返回有效计划；落点距离 30~41 码、x < 140（朝敌侧）✅
2. 同输入不带 openingBarrage：返回 null（普通模式不浪费）✅
3. 持久 openingBarrage 标志：整轮齐射保持前压模式 ✅
4. 回归：tsc / forbidden-ai / duel / br-strobe 全部 PASS ✅

## 结论
- 根因是"远敌不扔"检查让开局齐射永远规划失败；
- 修复后开局齐射改为前压弹幕，AI 会在开局连续引导空袭。