# V238 绝密模式：红色入口 + A 级武器进入限制 + 规则展示

## 需求
- 绝密模式用**红色入口**标识；
- 玩家至少配备一把 **A / S / S+ 级武器**才能进入（单持 A 级手枪不算，
  双持手枪算）；
- 条件不满足时拒绝进入，并展示规则：合格武器**带图片和名称、按枪械类型分类**。

## 实现

### 服务端
- `duelWeapons.ts`：新增 `isSecretEligibleWeapon(type)`（A/S/S+ 且非单持手枪）
  与 `getSecretEligibleCatalog()`（合格武器目录：分类 / 图片 / 名称 / 等级）；
- `apiServer.ts`：
  - `siteInfo` 返回 `extractionSecret.enabled`（客户端红色入口用）；
  - 新增 `GET /api/extraction/secret/eligible`（合格武器目录，规则展示用）。

### 客户端（main.ts / siteInfo.ts / index.html / app.css）
- **红色入口**：绝密模式开启时，搜打撤「开始对局」按钮标红并显示
  「绝密模式 · 开始对局」；
- **进入检查**：点击开始对局时，若绝密开启，拉取当前配装检查是否含合格武器，
  不满足则**阻止进入**并弹出规则面板；
- **规则面板**：展示规则文字 + 合格武器列表（图片 + 名称 + 等级），
  按武器类型（突击步枪 / 射手步枪 / 狙击枪 / 冲锋枪 / 轻机枪 / 霰弹枪等）分组。

## 验证
- `test:extraction-secret`：合格武器判定（m4a1/m249/awc/vector 合格；
  deagle/p30l 单持手枪不合格；deagle_dual/p30l_dual 双持合格；ak47/mp5 不合格）；
  合格目录 29 把且带图片；
- `test:admin`、server/client `tsc` + build：PASS。

> 说明：进入检查在客户端「开始对局」前完成（体验最好），配装不合格时弹规则
> 面板；服务端仍以现有 applyExtractionSpawnLoadout 发放配装。
