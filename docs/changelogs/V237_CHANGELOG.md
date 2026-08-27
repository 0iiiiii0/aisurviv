# V237 搜打撤新增「绝密模式」

## 需求
- 搜打撤新增绝密模式：AI 全部套用最终幸存者（last_man），AI 之间不互相攻击，
  AI 无限子弹；击杀 AI 有 1/5 概率随机掉落一个能力；高级物资掉率提高；
- 后台可调绝密 AI 难度和装备。

> 按需求取消「武器降级为 DP-28」规则（原计划 2/3 概率，已移除）。

## 实现

### 配置与后台（config.ts / adminServer.ts / 后台 UI）
- 新增 `Config.extractionSecret`：`enabled` 开关 + `aiDifficulty`（AI 难度）；
- 后台「搜打撤 AI 默认配装」下方新增「搜打撤·绝密模式」区块：
  启用开关 + AI 难度下拉 + 保存（接口 `/admin-api/extraction-secret-config`）；
- AI 装备沿用现有「搜打撤 AI 默认配装」（后台可编辑）。

### AI 行为（game.ts / player.ts / smartBot.ts / gameServer.ts）
- 绝密 AI 进局：在基础配装上**套用最终幸存者**（last_man）——
  perks：steelskin + splinter + 随机(takedown/windwalk/field_medic) + **endless_ammo**（无限子弹）；
  主武器槽为空补 M249、投掷物槽为空补 MIRV、补 3 级背包/最后幸存者头盔；
- **AI 之间不互相攻击**：worker 传 `BOT_EXTRACTION_SECRET`，smartBot 的
  `chooseEnemy` 在绝密模式下忽略其他 AI（isBot），只把真人当敌人；
- 绝密 AI 难度走后台配置（`extractionSecret.aiDifficulty`）。

### 掉落（player.ts / loot.ts）
- 击杀绝密 AI：**1/5 概率额外随机掉落一个能力**（19 种能力池）；
- 高级物资掉率：绝密模式权重 ×3（普通搜打撤是 ×0.1，普通模式不变）。

## 验证
- 新增 `test:extraction-secret`：绝密 AI 拥有 endless_ammo/steelskin/splinter/
  随机角色能力 + 主武器；绝密高级物资掉率（0.13% → 4.20%）明显高于普通搜打撤；
- `test:admin` 新增绝密配置接口断言（开关 + 难度 + 非法难度保留旧值）；
- `test:loot-nerf`、`test:extraction`、`test:bot-brain`：PASS；
- server / client `tsc` + build：PASS。
