# V156 验证记录：2 分 30 秒提醒

## 验证

1. 剩余时间首次 ≤ 150 秒时弹出「对局剩余 2 分 30 秒，请尽快撤离！」公告 ✓
2. 同一局只提醒一次（`matchTimeReminderShown` 标记）✓
3. 非搜打撤 / 未开局 / 观战不触发 ✓
4. 新对局重置标记 ✓
5. 构建：client tsc + vite build、server tsc PASS；
   test:extraction（solo/duo/squad）PASS ✓

## 结论

- 玩家在对局剩余 2 分 30 秒时会收到屏幕中央文字提醒；
- 倒计时条与 60 秒红色警示保持原有行为。
