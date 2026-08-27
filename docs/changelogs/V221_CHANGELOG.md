# V221 后台玩家仓库管理：物品图片 + 名称不再省略

## 需求
- 后台「玩家仓库」修改功能中，物品名称（如 helmet01 / backpack03）被省略号截断，
  需要完整显示；
- 每个仓库物品添加小尺寸图标（与局内 loot 图标一致）。

## 实现（client/public/admin）

### 物品图片
- `admin.js` 新增 `STASH_ITEM_IMAGES` 映射表（约 200 个物品类型），
  从 shared/defs 的 GunDefs / GearDefs / ThrowableDefs / MeleeDefs 的
  `lootImg.sprite` / `worldImg.sprite` 自动生成，路径统一为以 `/img` 开头的绝对路径
  （适配 `/admin/` 页面）；
- 弹药使用 `img/emotes/ammo-<type>.svg`，枪械使用圆形掉落图
  `img/loot/loot-weapon-<id>.svg`，医疗 / 护甲 / 头盔 / 背包 / 倍镜 / 投掷物 /
  近战均使用对应的 loot 图标；未知类型不显示图片；
- 物品图标尺寸 18×18px（`object-fit: contain`），不撑大胶囊行高。

### 名称完整显示
- `.stash-admin-item-name` 移除 `white-space: nowrap / text-overflow: ellipsis`，
  改为 `overflow-wrap: anywhere` 自动换行，长类型名不再被省略号截断。

## 验证
- 全部图片 URL 经脚本核对 `client/public/img` 下文件均存在（无破图）；
- admin.js `node --check` 语法通过；
- server `test:admin`、`test:v50-room-targets`：PASS；
- client `vite build` 通过，`dist/admin` 已同步更新。
