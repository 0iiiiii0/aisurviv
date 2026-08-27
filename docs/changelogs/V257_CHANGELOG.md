# V257 后台删除玩家账号

## 需求
- 后台添加删除玩家账号功能。

## 实现

### 服务端
- `playerAccounts.ts`：
  - 新增 `listAccounts()`（全部账号：用户名 / 显示名 / 创建时间）与
    `deleteAccount(username)`（删除账号并清除其全部登录会话）；
  - 所有读写操作加**文件锁 + 每次写前重载磁盘**（与 stash 一致），
    多进程 / 多实例下删除账号不会被旧的进程内缓存覆盖；
- `stash/stashManager.ts`：新增 `removePlayer(name)`（删除某玩家整个仓库）；
- `adminServer.ts`：`GET /admin-api/player-accounts`（列表）、
  `POST /admin-api/player-accounts/delete`（删除，同步清理该账号的登录会话
  与对应仓库，displayName 与 username 都尝试清理）。

### 后台 UI
- 新增「玩家账号」导航与面板：账号列表（显示名 / 用户名 / 创建时间）、
  搜索过滤、删除按钮（带确认提示），跟随全局自动刷新。

## 验证
- `playerAccountsSmokeTest` 新增：删除账号后无法登录、会话全部失效、
  列表不再包含、删除不存在账号抛错；
- server `tsc` PASS；client `vite build` PASS。
