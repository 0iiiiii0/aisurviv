# V89 修复：斯安威斯坦无法激活

## 需求

- 用户反馈：进入斯安威斯坦模式后技能无法激活。

## 根因

- V84 阶段1 完成了服务端技能逻辑（useItem 处理、世界时间减速、冷却等）；
  V87 阶段2 只实现了客户端 HUD 展示（技能槽、冷却、蓝调滤镜），
  **没有接入"按键触发激活"的输入链路**，因此游戏内按任何键都无法激活。

## 实现

- `shared/gameConfig.ts`：`protocolVersion` 86 → 87；
  `Input` 枚举新增 `Sandevistan`（默认键 G，追加在 Count 前，旧值不变）。
- `client/src/inputBinds.ts`：新增按键绑定
  `Sandevistan (斯安威斯坦) → Key.G`（可在设置中改键）。
- `client/src/game.ts`：输入组装把 `Input.Sandevistan` 加入发送列表，
  按 G 键即随 InputMsg 上传。
- `server/src/game/objects/player.ts`：`handleInput` 的 switch 新增
  `case Input.Sandevistan → activateSandevistan()`。
- `client/index.html` + `game.css`：技能槽标题旁显示按键提示 `[G]`。

## 激活方式

- 进入 2077·斯安威斯坦 模式，按 **G** 键激活（冷却就绪时）；
  激活后世界减速 35%、全屏蓝调，HUD 显示剩余时间；结束后进入 25s 冷却。

## 测试

- `sandevistanSmokeTest` 新增端到端断言：通过 `InputMsg.inputs =
  [Input.Sandevistan]` 调用 `handleInput` 后，`sandevistanActive = true`
  且 `worldTimeScale = 0.35`。
- server / client 构建通过；
- `test:v41-suite`（11 项）、`test:bot-input`、`test:v53-matchmaking`、
  `test:sandevistan` 全部 PASS。