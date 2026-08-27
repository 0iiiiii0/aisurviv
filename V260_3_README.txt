V260.3 — 搜打撤组队登录状态第二次修复

问题：
已登录玩家进入搜打撤双排/四排组队时，仍可能收到：
“搜打撤模式需要登录账号，其他模式可直接游玩”。

本次修复不是只在前端再次检查 localStorage token，而是增加服务端会话兜底：
1. /api/account/login 登录成功后写入 HttpOnly、SameSite=Lax 会话 Cookie。
2. /api/account/profile 恢复已有有效登录时也刷新该 Cookie，因此升级后无需强制重新注册账号。
3. /team_v2 WebSocket 握手时读取会话 Cookie。
4. 创建/加入搜打撤队伍时，如果客户端消息 token 缺失、旧版缓存导致未发送，或消息 token 已陈旧，
   服务端会使用握手 Cookie 再做一次权威账号验证；有效登录不再被错误判为游客。
5. logout 会同步清除 Cookie。
6. 生产服务器对 HTML 设置 no-store/no-cache，避免升级后浏览器继续使用旧页面入口。
7. 普通模式仍允许游客，搜打撤仍要求有效账号；没有取消登录限制。

验证：
- TypeScript 服务端完整编译通过。
- TeamMenu / PlayerAccount session race / Guest mode / find_game auth 回归通过。
- 实际生产入口 :8001 测试：HTTP 登录成功并返回会话 Cookie。
- 实际 WebSocket 测试：消息中故意发送错误旧 token，但握手 Cookie 有效，搜打撤双排仍正常创建，未返回 login_required。
- 首页 GET 返回 Cache-Control: no-store, no-cache, must-revalidate。
