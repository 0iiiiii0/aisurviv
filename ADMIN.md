# Surviv.io V41 管理后台

后台地址：`http://<服务器地址>:8001/admin/`

## 生产环境端口

- `8001/TCP`：游戏主页和管理后台，对公网开放；
- `3000/TCP`：区域延迟检测、匹配和房间管理入口，对公网开放；
- `9000-9063/TCP`：最多 64 个实际游戏房间的 WebSocket 直连端口，对公网开放；
- `8000/TCP`：账号和仓库 API，仅监听服务器回环地址，由 8001 反向代理，不要对公网开放。

只开放 3000 和 8001 时，网页与匹配请求可以成功，但客户端无法连接实际游戏房间。部署服务器及其上游安全组/NAT 必须同时放行并转发 TCP 9000-9063。房间端口采用直连是为了避免额外 WebSocket 转发造成吞吐和延迟损失。

## Windows 启动

双击项目根目录：

```text
START_V44.cmd
```

启动脚本会：

- 检查 Node.js 20 或更高版本；
- 在缺少依赖时执行 `npm install`；
- 拒绝复用已占用的 `8001`（主页）、`3000`（匹配）和 `8000`（内部 API）端口；
- 清理 `client/node_modules/.vite`，防止旧页面缓存；
- 启动当前源码的服务端和 Vite 客户端；
- 打开网页管理后台。

保持启动窗口开启。关闭窗口或按提示结束后，脚本会停止由它启动的三个任务。

本包不附带旧版 `SurvivLauncher.exe`。需要 EXE 启动器时，在 Windows 中执行：

```powershell
.\tools\SurvivLauncher\build.ps1
```

## 管理员密码

首次启动会创建根目录下的：

```text
survivio-admin-auth.json
```

随机初始密码会打印在服务端窗口，并以明文保存在该文件中。该文件已加入 `.gitignore`，不得上传或公开。也可以在首次启动前设置环境变量：

```powershell
$env:SURVIV_ADMIN_PASSWORD = "至少12个字符的密码"
```

登录后可在后台修改密码。会话令牌只保存在当前标签页的 `sessionStorage` 中。

## 后台能力

- 查看进程模式、运行时间、内存、在线真人、AI、观众和房间；
- 开关公开模式；随机 1v1 不能在后台重新开启；
- 分别设置单排、双排、四排房间人数上限；
- 设置公开模式自动补 AI 的频率、上限、比例和思考间隔；
- 设置默认 1v1 护甲、倍镜、激素、投掷物和 AI；
- 手动创建普通房间；
- 向支持的房间加入 AI；
- 为房间签发管理员观战凭据；
- 创建双方均为 AI 的自定义 1v1；
- 获得纯 AI 对局的本局观战链接；
- 发布限时全服公告；
- 停止指定房间。

## 单排、双排、四排人数上限

后台“公共房间人数上限”分别控制：

- `solo`：所有普通单排地图；
- `duo`：所有普通双排地图；
- `squad`：所有普通四排地图。

双排会规范为 2 的倍数，四排会规范为 4 的倍数。50v50、私人 1v1 和练枪房不使用这三个上限。

设置会写回 `survivio-config.json`，并立即用于新房间及自动补人容量判断。

## 纯 AI 1v1

后台“纯 AI 1v1”可以分别设置：

- AI 1 难度；
- AI 2 难度；
- AI 1 的两把武器；
- AI 2 的两把武器。

护甲、倍镜、激素和投掷物使用后台当前的公共 1v1 配置。创建成功后会显示本局八位观战码和观战链接。

Normal、Hard、Pro 可在正式多进程模式运行。LEGIT/HACKER 需要单进程权威上下文；不支持的进程模式会返回明确错误，不会建立半成品房间。

## 1v1 观战分享与管理员观战

两类观战方式用途不同：

### 本局分享码

私人 1v1 和纯 AI 1v1 会生成八位分享码：

- 非管理员也可以使用；
- 同一分享码允许多人同时观看；
- 每名观众获得不同的一次性连接凭据；
- 只在当前这一局有效；
- 对局结束或房间停止后立即失效。

### 管理员观战

房间列表中的“观战”按钮仍可为任意运行中房间签发 60 秒有效的一次性管理员观战凭据。该凭据只允许进入指定房间。

## V41 观战界面

观战者可以：

- 切换上一名或下一名玩家；
- 启用独立自由视角；
- 在自由视角中手动选择 0–3 层；
- 查看全体玩家头顶的生命值和当前武器；
- 打开大地图查看全局玩家状态；
- 给当前被观战玩家发送单独消息。

观众消息不会广播给另一名玩家或其他观众。服务端执行长度限制、控制字符清理和发送频率限制。

## 生产构建

Windows 静态部署：

```powershell
.\build-complete.ps1
```

脚本会重新构建服务端、删除旧 `client/dist`、重新构建客户端，并检查 `V44_OLD_DUEL_AI_MAP_FEASIBLE_DODGE` 标记。缺少标记的旧网页不会被当作有效产物。

示例 `nginx.conf` 已包含 `/admin-api` 与普通 `/api` 路由。公网部署时只在可信网络开放管理后台，并保护好管理员密码文件。

## 验证

```powershell
cd server
npm.cmd run build
npm.cmd run test:v41-suite

cd ..\client
node node_modules\typescript\bin\tsc --noEmit
node --check public\admin\admin.js
```

完整验证记录见：

- `docs/V44_OLD_DUEL_AI_MAP_FEASIBLE_DODGE.md`
- `docs/V43_LEAD_RICOCHET_UI_FIX.md`
- `docs/validation/V41_VALIDATION.txt`

## 玩家数据目录（server-data/）

玩家数据与代码分离，存放在独立目录，避免全量更新或误删项目根目录时把玩家数据一起清掉。

- **默认目录**：项目根目录下的 `server-data/`
  - `survivio-stash.json` —— 玩家仓库（搜打撤/仓库配装/撤离带出）
  - `survivio-player-accounts.json` —— 玩家账号
- **自定义目录**：设置环境变量 `SURVIV_DATA_DIR` 可指到项目外（例如 `D:\surviv-data`），
  全量更新项目时该目录不会被触碰：
  ```powershell
  $env:SURVIV_DATA_DIR = "D:\surviv-data"
  ```
- **自动迁移**：首次用新版本启动时，若 `server-data/` 里没有数据但项目根目录仍存在
  旧文件（`survivio-stash.json` / `survivio-player-accounts.json`），会自动复制过去。
- 部署/备份时请一并备份 `server-data/`；不要把它放进“替换代码”的复制范围。
- 说明：`survivio-config.json` 与 `survivio-admin-auth.json` 仍存放在项目根目录（属部署配置/后台凭据，非玩家数据）。
