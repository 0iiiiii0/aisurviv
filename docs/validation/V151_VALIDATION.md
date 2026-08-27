# V151 验证记录：AI 装备率优化

## 录像分析结论
- bot 408：错层物资（2.6 码但层不同）→ 卡住 → 放弃 ✅ 定位
- bot 406：建筑内箱子门口被墙挡、门已开却不穿门 → 反复放弃 ✅ 定位
- 放弃后 weapon-search 乱晃、不再拆可达箱子 ✅ 定位

## 修复验证
1. steerToward 穿门补丁：目标延伸到门洞对侧 ✅
2. chooseCrate 空手开放区域倾向（+45 室外 / -70 室内）✅
3. chooseUrgentEquipmentLoot 层匹配过滤（空手 + 不同层/建筑 → 排除）✅
4. 回归：tsc / loot-safety / resource-sweep / bot-brain / navigation-recovery /
   loot-ai / movement-jitter / v26-sim 全部 PASS ✅
5. 环境 8001/3000 正常 ✅

## 结论
- 空手 AI 优先可达资源，门口/错层卡住场景减少；
- 建议进对局后用新录像复查 break-crate 完成率与 resource_target_abandoned 次数。