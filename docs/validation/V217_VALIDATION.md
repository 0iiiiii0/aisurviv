# V217 验证记录：身份统一

## 验证

1. 仓库默认身份 = 大厅 playerName ✓
2. playerName 为空回退 Cookie ✓
3. 身份同步写入 Cookie ✓
4. 入局与仓库同源，不再"A 配装 B 入局" ✓
5. 构建：client tsc + vite build PASS ✓

## 结论

- 仓库配装始终作用于入局使用的同一身份。
