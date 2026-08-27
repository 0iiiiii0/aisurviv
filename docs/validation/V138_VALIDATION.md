# V138 验证记录：1v1 选装 UI 与各自投掷物

## 验证项
1. test:duel-lobby（新增断言）：
   - updateThrowables 按成员独立保存/返回 ✅
   - 房主视角可见对方投掷物摘要（players[1].throwables）✅
   - AI 模式：房主投掷物镜像给 AI 玩家 + 共享 loadout.throwables ✅
   - start 后 contestantLoadouts 双方携带各自投掷物 ✅
2. 回归：tsc / duel / v41-pure-ai / admin 全部 PASS ✅
3. client build（tsc + vite）PASS ✅
4. live API：
   - 房主 frag2+strobe3，访客 smoke5+potato1，各自独立 ✅
   - AI 模式 strobe6 同步 ✅
5. 环境：8001/3000 在线，api 200 ✅

## 结论
- 对方不再出现武器选择框，只显示已选武器 + 投掷物类型与数量；
- 双方各自选择自己的投掷物，自动保存；
- AI 模式保持镜像（武器+投掷物）。