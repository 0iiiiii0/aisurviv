# V166 全量测试套件运行记录

## 运行范围

`server/package.json` 中全部 95 个 `test:*` 冒烟测试（串行，ts-node 直跑），
覆盖：匹配/房间、AI 行为、1v1/靶场/2077/搜打撤、50v50、仓库、
网络协议、管理后台、战斗系统等全部模块。

## 结果

**PASS：95 / 95**

## 修复的 3 个失败

1. `v42AimTrainingSpectatorGuardSmokeTest`：协议版本锁定断言过时
   （期望 83，当前 87）——本轮新增 MatchTimeMsg 网络消息，按规范将
   `protocolVersion` 递增至 **88** 并更新断言；
2. `puzzleDoorSmokeTest`：`protocolVersion: 84` 断言过时 → 更新为 88；
3. `v43LeadUiLobbyRegressionSmokeTest`：1v1 对局配装新增 `throwables`
   字段（玩家自选投掷物），更新断言以包含投掷物结构。

## 构建

- server tsc：PASS
- client tsc + vite build（多页：index + storage）：PASS
- 服务端 8001 / 客户端 3000 运行正常

## 结论

- 全部 95 项测试通过；
- 网络协议版本随本轮改动正确递增（87 → 88），旧客户端会被拒绝。
