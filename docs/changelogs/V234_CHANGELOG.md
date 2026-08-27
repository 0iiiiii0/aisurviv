# V234 后台：给全体玩家仓库加物品 + 加减号步长与游戏一致

## 需求
- 后台新增「给全体玩家仓库添加物品」功能；
- 后台仓库管理中物品的 +/− 按钮，一次加减的量和正常使用一致
  （枪械一次 1 个、普通子弹一次 30 发、信号弹 1 发、.308 弹药 5 发、
  绷带 5 个、其余 1 个）。

## 实现

### 服务端
- `server/src/stash/stashManager.ts`：新增 `addItemToAll(type, count)`——
  遍历全部已有玩家仓库，按与 `addItem` 相同的分类 / 上限 / 双枪折算逻辑
  给每名玩家添加，返回实际更新到的玩家数；
- `server/src/adminServer.ts`：新增 `addItemToAllPlayers()` 与
  `POST /admin-api/extraction/stash/all` 接口（已鉴权）。

### 后台 UI（client/public/admin）
- 仓库管理底部新增「**给全体玩家添加**」区块：物品类型 + 每人数量 + 确认
  （提交前弹确认，提示将影响的玩家数）；
- 物品行的 +/− 按钮按游戏内步长显示并操作（`−30` / `+30` 等）：
  - 弹药：普通 30 / 信号弹 1 / .308 5；
  - 绷带 5；枪械、护甲、投掷物等 1；
  - 修复了旧逻辑把输入框当前值当增量的问题（点 + 会按当前值增加）；
  - 输入框保留「直接设置数量」功能（改数即 set）。

## 验证
- 新增 `test:stash-all-players`：3 名玩家全部收到 +30 弹药 / +1 枪械 /
  +2 双枪折算 / 无效类型拒绝；
- `test:admin`、server tsc / build、client vite build：PASS。
