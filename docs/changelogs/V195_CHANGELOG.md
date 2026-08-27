# V195 倍镜按倍率从小到大排序

## 需求

仓库「倍镜」分类按倍率从小到大排列。

## 实现

### client/src/extractionStashUi.ts
- `renderGrid` 对 scopes 类别按数字倍率排序
  （正则提取 `(\d+)x` → 1x / 2x / 4x / 8x / 15x）；
- 其余分类保持名称字母序。

## 验证

- client tsc + vite build：PASS
- 倍镜顺序：1x → 2x → 4x → 8x → 15x
