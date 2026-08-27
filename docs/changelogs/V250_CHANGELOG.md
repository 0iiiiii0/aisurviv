# V250 商店设置：只保留逐物品改价，初始金币固定为 0

## 需求
- 商店设置要的是**能更改每个商品的价格**；
- **初始金币固定为 0**，后台不再提供"初始金币"调整功能。

## 实现
- `config.ts`：移除 `ShopConfig.startCoins`（默认/归一化一并删除）；
- `stash/stashManager.ts`：新玩家初始 `coins = 0`，旧数据无金币字段也补 0；
- `adminServer.ts`：`getShopConfig` / `setShopConfig` 及路由不再处理
  `startCoins`，只保留开关 + 逐物品价格覆盖；
- 后台「商店设置」面板：删除「新玩家初始金币」输入框，只保留
  「启用商店」+ 逐物品买入/卖出价 + 保存；提示文案注明初始金币为 0，
  需先出售物资赚金币再购买；
- 仓库页商店提示同步更新（初始金币为 0）。

## 验证
- `shopSmokeTest` 更新：新玩家初始金币断言为 0；买卖流程改为测试内充值
  验证（真实游戏中靠出售物资赚金币）；
- server `tsc` PASS；client `vite build` PASS。
