# V215 验证记录：容量与协议上限

## 验证

1. 发放按背包等级容量限制（level1=240）✓
2. 普通库存 ≤ 510（无 511 无限哨兵风险）✓
3. 超限库存不被 addItem 减少 ✓
4. 弹药/药品/投掷物统一受容量与 510 约束 ✓
5. 构建与回归：server tsc、test:extraction / admin / all-modes PASS ✓

## 结论

- 无法绕过背包容量；
- 局内 inventory 不再出现 511 无限哨兵。
