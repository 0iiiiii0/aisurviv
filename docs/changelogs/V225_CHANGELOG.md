# V225 后台玩家仓库管理：补全「添加物品」类型

## 需求
- 后台「玩家仓库」添加物品时，类型建议列表缺很多物品（枪械 / 护甲等级 /
  倍镜 / 投掷物 / 近战等），导致想加的物品在建议里找不到。

## 实现（client/public/admin/admin.js）
- 新增 `STASH_SUGGESTED_TYPES` 常量（104 个**有效**物品 id）：
  - 枪械 53 把：ak47 / m4a1 / hk416 / mp5 / ump9 / vector / m93r / glock /
    p30l / ot38 / mosin / m39 / m249 / dp28 / groza / famas / scar / mp220 /
    deagle / qbb97 / an94 / sv98 / awc / svd / garand / saiga / spas12 /
    m1014 / usas / potato_cannon 等；
  - 弹药 8 种、药品 4 种、头盔 / 护甲 / 背包各等级、倍镜 1x–15x；
  - 投掷物 frag / smoke / strobe / mirv / snowball；
  - 近战 pan / katana / bayonet / knuckles / kukri_trad 等；
- 「添加物品」输入框的 datalist 建议由这些类型 + 玩家已有类型合并生成；
- 每个建议类型均通过服务端 `stashCategoryFor` 校验（可正常入库），
  并已在 `STASH_ITEM_IMAGES` 映射中有对应图标。

> 说明：sks / qbb / aug / m16a1 / g18c 等不是游戏内有效物品 id，
> 未列入建议（服务端会拒绝这些类型）。

## 验证
- 104 个建议类型全部通过服务端 `stashCategoryFor` 校验（0 个无效）；
- admin.js `node --check` 语法通过；
- `test:v50-room-targets`、`test:admin`：PASS；
- client `vite build` 通过，`dist/admin` 已更新。
