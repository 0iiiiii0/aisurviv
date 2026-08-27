# V186 枪旁显示所需弹药样式

## 需求

每把枪旁边附上所需的子弹样式（做小一点）。

## 实现

### client/src/extractionStashUi.ts
- 左栏武器槽的弹药行由通用弹药箱改为**该枪实际弹药图标**
  （`img/emotes/ammo-<口径>.svg`，如 AK → 762mm、MP5 → 9mm）；
- 同时显示口径文字与携带数量（如 `762mm x60`）；
- 无弹药定义的枪不显示弹药行。

### CSS（storage.css + app.css）
- 弹药行缩小：图标 15px → **12px**，文字 12px → **10px**。

## 验证

- client tsc + vite build：PASS
- AK/MP5/Vector 等显示对应口径弹药图标与数量
