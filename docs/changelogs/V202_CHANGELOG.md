# V202 装备栏位不再显示近战武器

## 需求

「装备」摘要栏不需要额外显示携带的近战武器（近战已在武器槽展示）。

## 实现

### client/src/extractionStashUi.ts
- renderLeft 装备摘要移除近战条目；
- 装备摘要仅显示头盔 / 护甲 / 背包 / 倍镜；
- 近战武器仍显示在左栏第 3 武器槽（#stash-weapon-2）。

## 验证

- client tsc + vite build：PASS
