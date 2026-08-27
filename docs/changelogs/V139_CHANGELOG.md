# V139 1v1 玩家卡片：对手武器大字+图片，投掷物配图

## 需求
- 对手的武器文字加大，并配上武器图片；
- 投掷物也要配上图片。

## 实现
`client/src/ui/duelLobby.ts` `renderPlayers`：
- 玩家卡片（双方，含对手）改为结构化展示：
  - 名字 + 身份（你/房主/玩家/电脑）；
  - **武器**：每个武器一个胶囊块 = 武器图片 + 名称，字号 13px（原 8px 小字）；
  - **投掷物**：每个非零投掷物 = 图片 + `名称×数量`（如 `红外空袭信标×4`）。
- 空位卡片保持「发送房间号或邀请链接」提示。

`client/css/duel-lobby.css`：
- `.duel-lobby-player-weapon`：图片 24px、名称 13px 粗体、浅色背景胶囊；
- `.duel-lobby-player-throwables`：图片 16px、名称×数量 10px 换行排列。

## 验证
- client build（tsc + vite）：PASS；
- headless Edge 实测（建房 + API 加入对手并各自配置）：
  - 房主卡片：M39 EMR + MP220（图片 + 13px 文字）；信标×4 + 土豆×2（带图）；
  - 对手卡片：AK-47 + Mosin-Nagant（图片 + 13px 文字）；手榴弹×2、
    MIRV×1、烟雾弹×3（全部带图）；
  - 图片均正常加载（/img/loot/loot-weapon-*.svg、loot-throwable-*.svg）。