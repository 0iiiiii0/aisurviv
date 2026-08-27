# V133 修复：斯安威斯坦使用时进度条不下降

## 现象
- 开启斯安威斯坦后，HUD 技能槽的进度条**保持满条不下降**（计时文字会走，
  但进度条不动）。

## 根因
- 客户端 HUD（`client/src/ui/ui2.ts`）在技能激活期间把进度条强制设为满格：
  `readiness = sandActive ? 1 : ...`；
- 数据链路本身是通的：服务端每个 update 都会把
  `sandevistanActive / sandevistanRemaining / sandevistanCooldown` 写入
  activePlayerData（`serializeActivePlayer` 无条件发送），客户端
  `setLocalData` 每帧读取并写入 `localData`，HUD 每帧读取；
- 因此问题只在 HUD 的显示逻辑：激活窗口内恒为 1，永远看不出"使用中消耗"。

## 修复
- `client/src/ui/ui2.ts`（HUD 更新循环）：
  - **激活中**：`readiness = sandRemaining / duration`（默认 5 秒），
    进度条随剩余时间从满格下降到空；
  - **冷却中**：保持原有回充逻辑 `1 - sandCooldown / totalCooldown`
    （从空格回充到满格）；
  - **就绪**：满格。
- 进度条 CSS 原有 `transform-origin: left center` + 0.1s 过渡，
  下降动画平滑，无需改动。

## 验证
### 协议回归（server/src/sandevistanSmokeTest.ts 新增第 13 组断言）
- UpdateMsg 序列化/反序列化往返：`sandevistanActive/Remaining/Cooldown`
  三字段完整保留（3.2s / 12s 误差 < 0.1s / 1s）；
- 防止以后有人改动协议或门控条件导致 HUD 数据断流。

### 端到端实测（headless Edge 真实进入 2077 对局）
- 点击 2077 按钮 → `POST /api/find_game` → ws 连接 → 进场；
- 按住鼠标中键激活（默认键位，按住跨帧以保证输入系统捕获按下）；
- HUD 采样（每 0.5s）：
  | 时间 | 图标 | 计时 | 进度条 scaleX |
  |---|---|---|---|
  | t+0.5s | active | 4.1s | 0.816 |
  | t+1.0s | active | 3.6s | 0.714 |
  | t+1.5s | active | 3.1s | 0.616 |
  | t+2.0s | active | 2.6s | 0.514 |
- 进度条与计时同步下降 ✓，连续 3 个采样递减 ✓。

## 回归
- server tsc：PASS；test:sandevistan：PASS；
- client build（tsc + vite）：PASS；
- dev 服务热重载后稳定运行，录像写入项目根 ai-match-recordings（V132 修复）。

## 备注
- 观战者跟随施法者时同样能实时看到进度条（activePlayerData 携带的是
  镜头目标的数据）。