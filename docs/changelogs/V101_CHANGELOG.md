# V101 修复：没有双枪形态的武器出现双枪

## 问题

- V100 放开"再次点击已装备单枪合成双枪"后，所有武器（包括没有双枪形态的
  AK-47 / AWM / M79 等）都能配出两把相同枪：仓库显示"（双枪）"标签，
  进局时服务端会把两把枪同时装进主/副武器槽。

## 根因

- 客户端 `toggleEquip` / `renderLeft` 只判断 `guns[0] === guns[1]`，
  没有校验该武器是否有 `_dual` 变体（`dualGunOf`）。
- 服务端 `setLoadout` / `grantLoadout` / `applyExtractionLoadout`
  同样不校验：重复的非双枪武器会被保存、重复扣仓并装备到两个武器槽。

## 修复

1. `client/src/extractionStashUi.ts`
   - `toggleEquip`：只有 `dualGunOf(type)` 存在（可合成双枪）时才允许
     再次点击合成双枪；没有双枪形态的武器点击已装备单枪 = 卸下。
   - `renderLeft`：`isDual` 与副槽空位逻辑都要求 `dualGunOf(guns[0])`
     存在；旧数据里两把相同的非双枪枪会按两个独立槽位展示，不再误标"（双枪）"。
2. `server/src/stash/stashManager.ts`
   - `setLoadout`：无双枪形态的武器去重（最多一把）；有双枪形态的武器
     仍允许两把。
   - `grantLoadout`：发放时跳过重复的非双枪武器，避免重复扣仓/重复发放。
   - `getStash` 迁移：自动把旧配装中的重复非双枪武器归一化。
3. `server/src/game/objects/player.ts`
   - `applyExtractionLoadout`：无双枪形态的武器最多装备一把（跳过重复项），
     有双枪形态的仍合成 `_dual`。
4. `server/src/extractionSmokeTest.ts`：新增回归断言
   （双枪 glock 合成 `glock_dual`、重复 ak47 只装一把）。

## 测试

- client / server `tsc` 通过。
- `test:extraction` 通过（含新增回归断言）。
- 手动验证 `setLoadout`/`grantLoadout`：`["m9","m9"]` 保留双枪，
  `["ak47","ak47"]` 归一为 `["ak47"]` 且只扣一把。
