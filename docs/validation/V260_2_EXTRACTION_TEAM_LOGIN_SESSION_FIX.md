# V260.2 搜打撤组队登录状态修复

## 问题

搜打撤队伍入口原先只用 `PlayerAccount.loggedIn`（本质上是浏览器本地是否存在 session token）作为进入前检查。
真正创建 `/team_v2` 房间时，服务端会再次通过 `PlayerAccounts.profile(token)` 做权威校验。两层状态之间存在空档：浏览器可显示已登录，但服务端随后把失效/尚未确认的 token 判为游客，于是队伍入口显示 `login_required`。

## 修复

1. `PlayerAccount` 新增 `validateSession()`，复用 `/api/account/profile` 权威校验，并保留已有的登录/恢复竞态保护。
2. `Application.tryJoinTeam()` 在**创建**普通或绝密搜打撤队伍前先 `await validateSession()`。
3. 复验通过后再同步 `TeamMenu` account token 并建立 WebSocket。
4. 服务端明确判定 token 失效时清除本地会话并要求重新登录；临时网络失败则保留 token，只提示重试。
5. 非搜打撤队伍不增加账号请求，游客规则保持不变。

## 验证

- Client TypeScript type-check: PASS
- Server TypeScript compile: PASS
- Existing team-menu smoke: PASS
- Existing player-account session-race smoke: PASS
- Existing guest-mode-access smoke: PASS（新增搜打撤队伍入口必须执行 `validateSession()` 的回归断言）
- Integration-style mocked account flow: fresh login token -> `/api/account/profile` -> valid = PASS; expired token -> local session cleared = PASS.
