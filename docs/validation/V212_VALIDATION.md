# V212 验证记录：重连防重复扣仓

## 验证

1. 首次加入发放并扣仓 ✓
2. 重连（复用 Player）不重复扣仓 ✓
3. extractionLoadoutGranted 标记置位 ✓
4. 局内装备不被覆盖 ✓
5. 构建与回归：server tsc、test:extraction / admin PASS ✓

## 结论

- 携带配装每局只发放一次，重连不再重复扣仓。
