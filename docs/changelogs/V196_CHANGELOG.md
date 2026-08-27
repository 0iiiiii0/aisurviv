# V196 弹药改用局内同款排序

## 需求

弹药分类不要按名称排序，使用局内背包同款顺序。

## 实现

### client/src/extractionStashUi.ts
- 弹药分类排序改为 `GameConfig.bagSizes` 键顺序
  （与局内背包显示一致）：
  **9mm → 762mm → 556mm → 12gauge → 50AE → 308sub → flare → 45acp**；
- 不在表中的弹药排在其后（字母序兜底）；
- 倍镜倍率排序与其他分类排序保持不变。

## 验证

- client tsc + vite build：PASS
- 弹药顺序与局内背包一致
