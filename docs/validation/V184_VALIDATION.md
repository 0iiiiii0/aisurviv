# V184 验证记录：近战入仓与携带

## 验证

1. 近战可存入仓库（melee 类别、堆叠）✓
2. 点击装备/卸下近战（loadout.melee）✓
3. 左栏第 3 武器槽与装备摘要显示近战 ✓
4. 进局装备 Melee slot、撤离回收 ✓
5. 新手包含 knuckles ✓
6. 构建与回归：server tsc、client build、test:extraction PASS ✓

## 结论

- 近战武器与其他物资一样：可存、可带、可进局、可回收。
