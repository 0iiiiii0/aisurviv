# V255 修复后台找不到玩家仓库

## 问题
- 后台「玩家仓库」列表看不到某些玩家（找不到玩家仓库）。

## 根因
- `stashManager.listAll()`（后台玩家列表用）读取的是**缓存的 `this.data`**，
  没有重新加载磁盘；而 `getStash()` 每次都会 reload。后台进程若在玩家创建
  仓库之前启动（或与游戏进程不同步），缓存里的玩家列表过期，列表就看不到
  后来创建的玩家。

## 修复
- `stash/stashManager.ts`：`listAll()` 改为每次通过 `readLatest` **重新加载
  磁盘**再返回（与 `getStash` 一致），后台刷新即可看到全部玩家。

## 增强
- 后台「玩家仓库」新增**搜索玩家**输入框：按玩家名过滤下拉列表，并显示
  「匹配数 / 总数」；没有匹配时给出明确提示，玩家再多也好找。

## 验证
- `stashAllPlayersSmokeTest` 新增：模拟另一进程后创建的玩家，原实例
  `listAll()` 通过磁盘 reload 能看到（修复前看不到）；
- shop / stash-all 冒烟测试 PASS；server `tsc` PASS；client `vite build` PASS。
