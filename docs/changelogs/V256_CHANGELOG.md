# V256 商店与搜打撤常开

## 需求
- 后台商店设置不需要"开启按钮"——商店**常开**；
- 搜打撤模式也**常开**（主界面始终显示，不需要后台开启）。

## 实现

### 商店常开
- `config.ts`：移除 `ShopConfig.enabled`（默认/归一化一并删除）；
- `economy/shopManager.ts`：移除 `enabled` 检查与目录 `enabled` 字段（恒开）；
- `adminServer.ts`：`getShopConfig` / `setShopConfig` 不再处理开关；
- 后台「商店设置」面板：删除「启用商店」复选框，只保留逐物品价格 + 保存；
- 客户端仓库页商店：移除 enabled 判断（恒显示）。

### 搜打撤常开
- `config.ts`：搜打撤默认启用（`battleRoyaleModes(..., true)`），
  `normalizeModeCatalogue` **强制** extraction `enabled=true`（配置文件/后台
  改不了，始终开放）；
- `adminServer.ts`：`setModeEnabled` 对搜打撤强制 `enabled=true`（不允许关闭）；
- 后台模式管理：搜打撤卡片隐藏开/关按钮，显示「常开」标记；
- `survivio-config.json`：搜打撤 单人/双人/四人 全部 `enabled=true`。

## 验证
- shop / bot-auto-fill / extraction 冒烟测试 PASS；server `tsc` PASS；
  client `vite build` PASS；dist/admin 已更新。
