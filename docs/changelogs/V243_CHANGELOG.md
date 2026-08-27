# V243 经济系统：商店购买 / 出售（搜打撤）

## 需求
- 玩家可在**商店**购买和出售物资（搜打撤仓库页面新增「商店」页签）；
- **不可能获得的物品不出现**（四级甲、各种帽子/角色皮肤头盔、占位背包、
  彩蛋枪、模式/活动专属物品、能力等）；
- **S/S+ 级武器、信号弹（flare）、信号枪（flare_gun）、AWM 子弹（308sub）
  不允许购买、只允许出售**；
- 定价先按物品等级/稀有度给出默认值，后台可逐物品修改。

## 实现

### 服务端
- `stash/stashManager.ts`：`PlayerStash` 新增 `coins`（金币）；新玩家按
  `Config.shop.startCoins` 发放初始金币，旧数据自动补发；新增
  `getCoins / setCoins / addCoins / removeCoins`；导出 `stackCap`；
- 新增 `economy/shopManager.ts`：
  - 商店目录动态生成（枪械 base / 弹药 / 药品 / 投掷物 / 近战 / 护甲 / 倍镜），
    排除「不可能获得」物品；
  - S/S+ 武器与 flare / flare_gun / 308sub 强制「仅出售」（硬规则，后台设
    买入价也不会放开）；
  - 默认定价：按武器等级（D 100 ~ S+ 2000）、弹药 2~8/发、药品 10~60、
    护甲按等级 80~700、倍镜 100~1500 等；出售价默认 = 买入价 × 0.5；
  - `getShopCatalog / shopBuy / shopSell / shopAdminCatalog /
    shopPriceOverrides`；
- `config.ts`：新增 `Config.shop`（enabled / startCoins / prices 覆盖）与
  `saveShopConfig()`；
- `apiServer.ts`：`GET /api/shop/catalog`、`POST /api/shop/buy`、
  `POST /api/shop/sell`（带限流）；
- `adminServer.ts`：`GET/POST /admin-api/shop/config`（开关 / 初始金币 /
  逐物品价格覆盖，留空恢复默认、填 0 禁止）。

### 客户端
- `storage.html` + `storage.ts`：仓库页面顶部新增「仓库 / 商店」页签与金币
  显示；商店页签展示目录（图片 / 名称 / 仓库数量 / 买入价 / 卖出价 /
  购买 / 出售按钮）；
- `extractionStashUi.ts`：新增商店加载、渲染、购买、出售逻辑（弹药按组：
  普通 30 发、.308 5 发、信号弹 1 发；其余 1 个）；
- `css/storage.css`：商店样式（金币金色、仅出售红色标记等）。

### 后台
- `admin/index.html` + `admin.css`：新增「商店设置」面板；
- `admin.js`：开关 / 初始金币 / 按类别逐物品买入·卖出价输入（显示默认价），
  保存只提交被修改的价格。

## 验证
- 新增 `server/src/shopSmokeTest.ts`（`test:shop`）：
  初始金币、目录排除、仅出售规则、购买/出售交易、后台价格覆盖、
  S 级硬规则不可购买，全部通过；
- server `tsc` PASS；client `vite build` PASS（dist/admin、storage 已更新）。
