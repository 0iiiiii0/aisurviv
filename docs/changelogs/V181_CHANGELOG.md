# V181 倍镜可配置

## 需求

倍镜也要能配置（仓库配装）。

## 现状确认与补齐

- 装备逻辑本就支持 scope 槽（点击护甲类中的倍镜物品装备/卸下，
  `armorSlotFor` 含 scope；进局 `applyExtractionLoadout` 设置 zoom）；
- 缺口：**新手包不含倍镜**，新玩家仓库里看不到可配置的倍镜。

## 实现

### 服务端（server/src/stash/stashManager.ts）
- 新手包 armor 增加 `1xscope` ×1（基础倍镜）。

### 客户端（storage.html + extractionStashUi.ts）
- /storage 左栏「装备」摘要新增倍镜显示（头盔 / 护甲 / 背包 / 倍镜
  图标 + 名称），配置结果可见；
- 点击仓库中 1x/2x/4x/8x/15x 倍镜即可装备/卸下。

## 验证

- 新玩家仓库含 1xscope ✓
- 装备 2xscope 保存成功、loadout.armor.scope 正确 ✓
- server tsc / client build / test:extraction：PASS
