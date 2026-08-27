# V128 后台新增玩家仓库物品修改功能

## 需求

- 后台可以修改玩家仓库物品（添加 / 移除 / 设置数量）。

## 实现

### 服务端
- `server/src/stash/stashManager.ts`：新增 `setItem(name, type, count)`
  —— 把某物品数量直接设为指定值（0 = 移除），双枪按基准枪折算。
- `server/src/adminServer.ts`：
  - `modifyExtractionStashItem`：`action = add / remove / set`（默认 set）。
  - 新增 `POST /admin-api/extraction/stash` 接口（已授权）。

### 后台 UI（client/public/admin）
- 侧边栏新增"仓库"导航，对应 `#stash` 区块。
- 玩家下拉选择 + 刷新按钮；选中玩家后按类别展示所有物品。
- 每个物品：−1 / 数量输入框（改数即设置）/ ＋1。
- 底部"添加物品"：输入类型（带常用类型提示）+ 数量。

## 验证

- `setItem` 单测：设为 3 / 设为 0 移除 / 无效类型拒绝 / 双枪折算 2 把。
- `test:admin` 通过；server `tsc`、client `vite build` 通过。
- 后台静态资源（admin.js/index.html/css）已随构建更新到 `dist/admin`。
