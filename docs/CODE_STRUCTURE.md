# 代码结构总览

> 生成时间：2026-08-05。目的：让新改动快速定位到正确模块，避免继续在巨型文件里堆代码。

## 1. 仓库布局

```
surviv.io-main-v53-matchmaking-recovery/
├── server/                服务端（Node + uWebSockets.js，ts-node 运行）
│   ├── src/
│   │   ├── devServer.ts       开发入口（单进程：API + 游戏 + 管理后台）
│   │   ├── gameServer.ts      游戏服务器（房间生命周期、AI worker、匹配）
│   │   ├── apiServer.ts       API 服务器（仓库/商店/账号/匹配接口）
│   │   ├── adminServer.ts     管理后台后端（/admin-api/*）
│   │   ├── smartBot.ts        AI worker 入口（单文件巨类，见 §4）
│   │   ├── config.ts          统一配置对象 + 数据目录解析
│   │   ├── playerAccounts.ts  账号系统（登录/会话）
│   │   ├── teamMenu.ts        组队大厅
│   │   ├── duelLobby.ts       1v1 大厅
│   │   ├── game/              游戏核心
│   │   │   ├── game.ts        对局逻辑（恢复版，@ts-nocheck，见 §4）
│   │   │   ├── map.ts         地图/碰撞
│   │   │   ├── gameManager.ts     模式配置注册
│   │   │   ├── gameModeManager.ts 模式策略
│   │   │   ├── gameProcessManager.ts 多进程房间 worker
│   │   │   └── objects/       player/loot/bullet/obstacle/plane/...
│   │   ├── bot/               AI 策略模块（47 个文件，按职责拆分）
│   │   │   ├── modeSystems/   各模式的基础 AI 参数
│   │   │   ├── *.strategy.ts  寻路/战斗/搜刮/烟雾/撤退/组队等
│   │   │   └── ...
│   │   ├── stash/             玩家仓库（stashManager.ts）
│   │   ├── economy/           商店（shopManager.ts）
│   │   ├── utils/             日志/网络/锁等工具
│   │   └── *SmokeTest.ts      回归测试（与源码同目录）
│   └── dist/                  生产多进程模式使用的编译产物（勿手动删）
├── client/                客户端（Vite + PixiJS）
│   ├── src/
│   │   ├── main.ts            入口
│   │   ├── game.ts            对局主逻辑
│   │   ├── ui/                HUD/大厅/仓库 UI（ui.ts、ui2.ts、extractionStashUi.ts...）
│   │   ├── objects/           渲染对象（player/particles/sandevistanFx...）
│   │   └── ...
│   └── public/admin/          管理后台前端（admin.js + index.html）
├── shared/                两端共享定义
│   ├── gameConfig.ts          协议版本号（protocolVersion）
│   ├── net/                   网络消息协议（27 个文件）
│   ├── defs/                  物体/枪械/地图/能力定义
│   └── utils/
├── server-data/           权威玩家数据目录（仓库/账号/管理员，勿提交 git）
├── crash-logs/            服务端崩溃日志（运行时生成）
├── docs/                  设计文档 + 本文件
├── tools/                 辅助脚本（launcher 源码、日志分析器）
└── start-surviv.ps1       启动器
```

## 2. 关键数据流

- **玩家数据**：运行时只读写 `server-data/`（或 `SURVIV_DATA_DIR`）。根目录的
  `survivio-stash.json` 等旧副本已归档，不要再往根目录写玩家数据。
- **配置**：`survivio-config.json` 在项目根（`config.ts` 的 `configPath`），由后台
  保存，是唯一活跃配置；它不参与 Syncthing 同步。
- **网络协议**：`shared/net/` 定义消息；协议版本号在 `shared/gameConfig.ts`。
- **AI worker**：`gameServer.ts` 按房间 fork `smartBot.ts` worker；worker 与房间
  通过 socket 通信。

## 3. 测试

- 全部是冒烟测试（`*SmokeTest.ts` / `*Simulation.ts`），与源码同目录。
- 运行：`cd server && npm run test:<名称>`（见 `server/package.json` 的 scripts）。
- 常用基线：`test:extraction`、`test:extraction-secret`、`test:extraction-boss`、
  `test:loot-nerf`、`test:loot-safety`、`test:v53-matchmaking`、`test:room-lifecycle`、
  `test:extraction-join-window`、`test:admin`、`test:bot-brain`、`test:combat-tactics`、
  `test:mode-isolation`、`test:sandevistan`、`test:shop`、`test:reconnect`。

## 4. 已知技术债（“屎山”热点）

### 4.1 `server/src/game/game.ts`（1117 行，`@ts-nocheck`）

- ✅ 2026-08-05 已重写为完整带类型的 TypeScript（保留全部逻辑：extraction / boss /
  sandevistan / arena / 重连窗口等），移除 `@ts-nocheck`。
- ✅ `tsc --noEmit` 0 错误，`npm run build` 成功，`server/dist` 已用当前代码重新生成，
  多进程模式（processMode=multi）可正常构建运行。
- 恢复前的旧版（JS 风格）备份在 `.codex-backups/game.ts.recovered-20260805.ts`。

### 4.2 `server/src/smartBot.ts`（21704 行，单文件）

- ✅ 2026-08-05 已拆出 `server/src/bot/smartBotSupport.ts`（约 1200 行）：全部接口/
  类型、纯函数助手（数学/武器评分）、`ObjectPool`、`SquadCoordinator`、worker 环境
  配置解析。`smartBot.ts` 从 21772 行降到 20604 行，保留 `TacticalBot` + worker
  入口（bootstrap）。
- 剩余 `TacticalBot` 巨类约 1.9 万行、337 个方法（334 个 private、互相强耦合）。
  拆分它需要先把 private 改为 public 并用原型注入（prototype-install）模式逐批搬移，
  属于高风险操作，建议按批小步进行（每批跑 `test:bot-brain`、
  `test:combat-tactics`、`test:extraction-hunter`、`test:cooperation` 等验证）。

### 4.3 其他大文件

| 文件 | 行数 | 说明 |
| --- | --- | --- |
| `game/objects/player.ts` | 5878 | 玩家对象（含大量模式分支） |
| `bot/forbiddenCombat.ts` | 2724 | LEGIT/HACKER 战斗规则 |
| `gameServer.ts` | 2113 | 房间/匹配/worker |
| `adminServer.ts` | 1916 | 后台接口 |
| `bot/mapStrategy.ts` | 1839 | 寻路策略 |

## 5. 版本控制

- 2026-08-05 已 `git init` 并提交基线快照（commit `92ecb2c`），后续改动请先
  `git add -A && git commit` 再动手，避免再次出现“文件被截断无法恢复”。
- `.gitignore` 已排除 `server-data/`、`node_modules/`、`dist/`、日志等。
- `.stignore`（Syncthing）与 `.gitignore` 各自独立，均不要提交玩家数据。
