# V223 玩家改为账号密码登录

## 需求
- 玩家进入对局不再直接输入名字，而是使用账号密码登录；
- 支持注册新账号 / 登录已有账号，会话在刷新后保持；
- 登录后局内显示名 = 账号名，搜打撤仓库身份自动绑定账号。

## 实现

### 服务端（server/src）
- 新增 `playerAccounts.ts`（玩家账号管理器）：
  - 持久化到 `survivio-player-accounts.json`（原子写入 tmp + rename）；
  - 密码使用 **scrypt + 每用户随机 salt** 哈希存储，文件里绝不出现明文密码；
  - 登录签发 30 天有效的随机会话 token，10 分钟定期清理过期会话；
  - 用户名规范化（小写 + trim），支持字母 / 数字 / 下划线 / 中文，3–16 位；
    密码 6–64 位。
- `apiServer.ts` 新增 `/api/account/*` 接口（均带 CORS + 限流）：
  - `POST /api/account/register` { username, password } → 注册并返回资料；
  - `POST /api/account/login` { username, password } → 返回 token + 资料；
  - `POST /api/account/logout` { token }；
  - `POST /api/account/profile` { token } → 校验会话并返回资料。

### 客户端（client/src + index.html + css）
- 新增 `playerAccount.ts`：会话管理（localStorage 存 token/显示名），
  封装 register / login / logout / restoreSession；
- 主菜单 `#player-options` 中名字输入框替换为**账号登录面板**：
  - 未登录：账号 + 密码输入框 + [登录] [注册] 按钮 + 状态提示；
  - 已登录：显示「账号名」+ [退出登录]；
  - 启动时自动恢复会话（token 无效则静默清除）；
- `main.ts`：
  - 进普通对局（快速开始 / 组队 / 1v1 房间）前强制 `requireLogin()`，
    未登录时提示「请先登录账号后再进入对局」；
  - `setConfigFromDOM()` 在已登录时使用账号显示名作为局内名字；
  - 登录 / 注册 / 退出事件绑定，密码框回车可直接登录；
- 搜打撤仓库：`extractionStashUi.ts` 在已登录时自动把仓库身份
  设为账号显示名（输入框只读），未登录仍可用原玩家名；
- 观战（观战码 / 后台观战）不要求登录，不受影响。

## 验证

- 新增 `test:player-accounts`（playerAccountsSmokeTest.ts）：注册 / 登录 /
  退出 / 会话校验 / 用户名规范化 / 重复注册 / 错误密码 / 密码规则 /
  文件不存明文密码 —— PASS；
- server `tsc --noEmit`、client `tsc --noEmit`：PASS；
- `test:admin`、`test:v50-room-targets`：PASS；
- client `vite build` 通过，`dist` 已更新（登录 UI + 账号代码已打包）。

> 说明：训练场（aim training）与普通对局一样要求先登录；观战不要求。
