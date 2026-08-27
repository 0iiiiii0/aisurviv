V260.2 HOTFIX - 搜打撤组队登录状态复验

基于 V260.1 完整项目。

修复：
- 修复玩家界面已登录后，进入普通/绝密搜打撤邀请组队或四人组队时，仍可能出现
  “搜打撤模式需要登录账号，其他模式可直接游玩”的错误提示。
- 创建搜打撤队伍前，客户端现在会先调用 /api/account/profile 对当前 session token
  做一次权威复验；通过后才建立 /team_v2 WebSocket。
- token 已过期时会清除失效会话并提示重新登录；网络暂时无法完成复验时不会误报
  “未登录”，而是提示“登录状态验证失败，请重试”。
- 普通模式继续允许游客；搜打撤仍要求有效账号，不放宽原有权限规则。
- 保留 V260.1 真人/AI 组队隔离修复及此前全部功能。

主要修改：
- client/src/playerAccount.ts
- client/src/main.ts
- client/dist/js/app-Cc4kTT4W.js（同步更新生产构建产物）
- server/src/guestModeAccessSmokeTest.ts（回归断言）

验证：
- client TypeScript --noEmit：PASS
- server TypeScript build：PASS
- team menu smoke：PASS
- player account session race smoke：PASS
- guest mode access smoke：PASS
- 登录 -> profile 复验 -> 搜打撤组队前置验证模拟：PASS
