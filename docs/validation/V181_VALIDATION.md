# V181 验证记录：倍镜配置

## 验证

1. 新手包含 1xscope ✓
2. 点击倍镜物品可装备/卸下（scope 槽）✓
3. 左栏装备摘要显示当前倍镜 ✓
4. 进局配装扣除与 zoom 应用逻辑保持（applyExtractionLoadout）✓
5. 构建与回归：server tsc、client build、test:extraction PASS ✓

## 结论

- 倍镜与其他护甲一样可配置、可见、可带入。
