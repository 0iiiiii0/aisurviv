# V199 验证记录：双枪机制

## 验证

1. 双枪按两把单枪存放（glock_dual → glock×2）✓
2. 配装两把同枪保存 ✓
3. 进局合成 glock_dual、副槽空 ✓
4. 旧双枪库存迁移 ✓
5. UI 双枪显示与交互 ✓
6. 构建与回归：server tsc、client build、test:extraction PASS ✓

## 结论

- 双枪与单枪统一为同一种物品，实战自动合成且不占副槽。
