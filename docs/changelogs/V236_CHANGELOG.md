# V236 搜打撤掉落：大幅降低高级物资掉率（不影响其他模式）

## 需求
- 搜打撤地图大幅降低高级物资的掉率/刷新率：
  S 与 S+ 枪械、三级护甲/头盔、AWM 弹药、信号枪、信号弹、8x/15x 倍镜；
- 只影响搜打撤（extractionMode），不改变其他模式。

## 实现（server/src/game/objects/loot.ts）
- 新增 `EXTRACTION_RARE_LOOT` 集合：
  - S+ 枪：awc / m1014 / usas / potato_cannon；
  - S 枪：m4a1 / m249 / mosin / saiga / spas12 / sv98 / scarssr / potato_smg；
  - 三级甲/头盔：chest03 / helmet03；
  - AWM 弹药（.308）/ 信号弹 / 信号枪：308sub / flare / flare_gun / flare_gun_dual；
  - 8x / 15x 倍镜：8xscope / 15xscope；
- `_getLootTable` 在 `extractionMode` 下把这些物品的**掉落权重乘以 0.1**
  （降到原来的 10%），普通模式权重不变。

> 说明：只影响"掉落抽取概率"（地面刷新 + 常规容器共用 lootTable）；
> 地图固定点的高级容器（sv98 专用箱等）不受影响。已有对局的地图在开局时
> 生成，改后需重启服务器、新开局生效。

## 验证
- 抽样对比（extraction vs main）：
  - 稀有枪：0.20% vs 1.47%；三级甲：0.13% vs 1.50%；8x/15x：0.27% vs 3.50%；
- 新增 `test:loot-nerf`（断言 extraction 高级物资命中率 < main 的 1/5，
  且 main 保持正常）；
- server `tsc` / build：PASS。
