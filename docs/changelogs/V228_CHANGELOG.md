# V228 导入玩家账号（默认密码 1234）+ 支持修改密码

## 需求
- 把 survivio-stash.json 里的 11 个现有玩家账号导入账号系统，
  初始密码统一为 **1234**；
- 玩家登录后可以自行修改密码。

## 实现

### 账号规则调整（server/src/playerAccounts.ts）
- 密码最小长度 6 → **4**（支持默认密码 1234）；
- 用户名最小长度 3 → **2**（支持现有玩家 "sb"）；
- 用户名允许内部空格（支持现有玩家 "ba ba da wo"，key 仍小写规范化，
  displayName 保留原样以匹配仓库身份）；
- 新增 `changePassword(token, currentPassword, nextPassword)`：
  校验当前密码 → 更新 scrypt 哈希 → 吊销该用户其它会话（保留当前会话）。

### 接口与客户端
- `apiServer.ts`：新增 `POST /api/account/change_password`（限流 10 次/分钟）；
- `client/src/playerAccount.ts`：新增 `changePassword()`；
- 主菜单登录面板：已登录状态新增 **「修改密码」** 按钮，展开
  当前密码 + 新密码 + 确认/取消（回车可确认）。

### 账号导入
- 用 PlayerAccounts（与运行时同一哈希算法）写入
  `survivio-player-accounts.json`（项目根），共 11 个账号：
  `gujian / sb / AAA / XNOR / 0w0 / Chinese / zzz / blueking /
  wytreuhsg / sjsb / ba ba da wo`，初始密码均为 **1234**；
- 文件只存 scrypt 哈希 + 随机盐，无任何明文密码；
- 已逐一验证 11 个账号都能用 1234 登录，且改密后旧密码失效、新密码生效。

## 验证
- `test:player-accounts`（更新：改密/其它会话吊销/2 字符用户名/空格用户名/
  4 位默认密码）PASS；
- server / client `tsc` PASS；client `vite build` PASS。

> 部署：把 `survivio-player-accounts.json` 复制到服务器项目根
> （与 survivio-config.json 同级），玩家用原玩家名 + 1234 登录后
> 即可在菜单「修改密码」自行更改。
