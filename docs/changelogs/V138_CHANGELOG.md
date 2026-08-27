# V138 1v1 真人对战选装 UI 优化：隐藏对方选框 + 各自选择投掷物

## 需求
- 优化 1v1 真人对战各自挑选武器时的选择 UI；
- 不要显示对方武器的选择框——只显示对方已选择的武器与投掷物类型和数量；
- 投掷物改为双方各自选择（此前是房主统一的公共配置）。

## 实现

### 服务端
1. `server/src/duelMatchTypes.ts`
   - `DuelPlayerWeapons` 新增可选 `throwables`；`cloneDuelPlayerWeapons` 同步克隆。
2. `server/src/duelLobby.ts`
   - 每个成员新增独立 `throwables`（默认取后台公共投掷物配置）；
   - 新增 `updateThrowables(code, memberToken, throwables)`：任何成员都能改
     自己的投掷物；AI 模式下房主的投掷物自动镜像给 AI（与武器一致）；
   - `resolveContestantLoadouts`：每位参赛者携带自己的投掷物进入对局；
   - snapshot：新增 `myThrowables`，玩家列表每项新增 `throwables`
     （用于对方摘要卡片），AI 玩家项同步显示房主的投掷物。
3. `server/src/gameServer.ts`
   - 新增 `update-throwables` 动作路由；
   - 建房时 `duelPlayerLoadouts` 携带每人投掷物（缺省时仍回退共享配置，
     纯 AI 后台建房不受影响）。
4. `server/src/game/objects/player.ts`
   - `applyArenaStartingLoadout` 按玩家下标应用各自的投掷物，覆盖共享
     默认值。

### 客户端
1. `client/src/ui/duelLobby.ts`
   - 玩家卡片：只保留摘要——名字 + 已选武器 + **投掷物摘要**
     （如 `信标×3 · 手榴弹×2`），不渲染对方的选框；
   - 投掷物步进器改为「我的投掷物」独立保存通道
     （`update-throwables`），所有玩家可编辑自己的（不再只有房主）；
   - 公共规则通道不再读取/写入投掷物（仍携带原值保持协议兼容）；
   - AI 模式提示文案改为“强制镜像房主武器与投掷物”。
2. `client/index.html`：投掷物区块标题改为「我的投掷物 · 各自选择 · 自动保存」。
3. `client/css/duel-lobby.css`：新增对手投掷物摘要行样式。

## 验证
- `test:duel-lobby`：新增断言——双方各自投掷物独立保存/读取、对手摘要可见、
  AI 模式镜像、开赛后每位参赛者携带各自投掷物；全部 PASS；
- 回归：server tsc、test:duel、test:v41-pure-ai（无每人投掷物时回退共享）、
  test:admin、client build 全部 PASS；
- live API 实测：房主 frag2+strobe3、访客 smoke5+potato1 各自独立；
  AI 模式房主 strobe6 → AI 玩家与共享配置同步为 strobe6。

## 备注
- 真人对战中对方只显示已选武器和投掷物数量，不暴露选择过程；
- 后台公共投掷物配置仍是新成员/纯 AI 对局的默认值。