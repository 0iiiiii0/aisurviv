# V163 修复进入断线 + 仓库界面重做（单独界面 / cookie 身份 / 图片化）

## 一、修复 "进入后 Host closed the connection"

### 根因 1：热重载后定时器调用失效方法（server/src/gameServer.ts）
- ts-node --watch 重载时，旧的 `setInterval` 仍持有旧实例引用，
  调用 `this.tickExtractionReplenish` 抛出
  `TypeError: this.tickExtractionReplenish is not a function` → 进程崩溃；
- 修复：定时器回调前做 `typeof this.xxx === "function"` 防御检查
  （`runBotAutoFillTick` 与 `tickExtractionReplenish`）。

### 根因 2：uWS 响应中止竞态（server/src/utils/serverHelpers.ts）
- 客户端提前断开 POST 请求时，`returnJson` 的 `cork` 回调与
  `onAborted` 存在竞态，uWS 抛
  "HttpResponse must not be accessed after onAborted" → **整服崩溃**，
  玩家全部断线；
- 修复：`returnJson` / `cors` / `forbidden` 全部加 try/catch 防御，
  中止后的响应操作静默忽略，不再拖垮服务器。

## 二、仓库界面重做

### 身份（浏览器 cookie）
- 玩家名存入 `surviv_stash_name` cookie（365 天），打开仓库自动读取，
  无需重复输入。

### 单独界面（client/index.html + app.css）
- 全屏覆盖式独立界面：顶部标题 + 身份输入 + 关闭；
- **左栏**：CSS 小人 + 头盔/护甲/背包/倍镜装备槽（图片）、
  主副武器槽（枪图 + 对应弹药数量）、携带统计
  （弹药 / 药品 / 投掷物，局内 HUD 式图标 + 数量）；
- **右栏**：仓库全部物资按 枪械 / 护甲 / 弹药 / 药品 / 投掷物
  分类网格展示，每项带**物品图片 + 数量**；
- 交互：枪械/护甲点击装备/再点卸下；弹药/药品/投掷物左键携带+1、
  右键携带-1；卡片右上角 × 移除 1 个；改动自动保存配装。

### 投掷物入仓（server/src/stash/stashManager.ts）
- 新增 `throwables` 分类（手雷/烟雾等可存放），带入配装支持投掷物
  （`loadout.throwables`），进局时从仓库扣除并带入。

## 验证

- 连续 5 次中途 abort POST 请求后服务器仍存活 ✓
- stash API：枪/弹药/药品/护甲/投掷物存取正常；配装含投掷物保存成功 ✓
- server tsc / client tsc + vite build：PASS
- test:extraction（含 stash 集成）：PASS
