# V254 修复 308sub 配装错误

## 问题
- 普通配装「精确射手」（mosin）与绝密配装「绝密狙击」（sv98）把弹药配成了
  **308sub**，但这两把枪实际使用 **762mm**（308sub 只有 AWC/AWM 使用）——
  AI 进局后枪与弹药不匹配（有枪没对应弹药）。

## 修复
- `extractionLoadouts.ts`：
  - 普通「精确射手」mosin：`308sub` → `762mm`；
  - 绝密「绝密狙击」sv98：`308sub` → `762mm`；
- `config.ts`：内联的普通配装默认值同步修正（mosin → 762mm）。

## 验证
- `extractionSmokeTest` 新增校验：默认配装中每把枪的弹药类型必须与枪械实际
  弹药匹配（mosin/sv98 需 762mm、awc 需 308sub 等）；
- extraction / extraction-secret-loadout 冒烟测试 PASS；server `tsc` PASS。
