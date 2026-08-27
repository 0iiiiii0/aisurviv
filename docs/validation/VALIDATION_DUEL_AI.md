# 1v1 AI 与观战功能验证记录

## 已通过的静态检查

- `npm --prefix server run build`
- `npm --prefix server run test:duel`
- `npm --prefix server run test:duel-lobby`
- `npm --prefix server run test:admin`
- `node client/node_modules/typescript/bin/tsc --noEmit -p client/tsconfig.json`
- `node --check client/public/admin/admin.js`

## 已通过的进程级验证

使用真实开发服务进程完成：

1. 创建“1 真人 + 1 AI”的私有 1v1 房间。
2. AI 使用第二个正常加入令牌进入房间。
3. AI 持续在线并正确消费 Duel 的 `ArenaRound` 消息。
4. 后台为运行中的房间签发一次性观战令牌。
5. WebSocket 观战客户端进入后：
   - 本地玩家 ID 与被观战玩家 ID 不同；
   - 本地观战者为死亡状态；
   - 自动跟随存活玩家；
   - 不增加存活人数。
6. 重复“加入AI”操作被拒绝。
7. 激素关闭房间中：
   - 开局 boost 为 0；
   - Soda/Painkiller 为 0；
   - 无限绷带和医疗箱规则保留。

## Duel 协议兼容修正

Duel 地图会发送 `ArenaRound` 记分消息。AI 已增加该消息的完整反序列化；同时消费 `Stats` 字符串消息，防止未读取载荷导致后续消息边界错位。

## 客户端生产构建说明

客户端源代码已通过 TypeScript 无输出检查，管理后台静态文件也已同步到 `client/dist/admin/`。

当前交付环境中的 `client/node_modules` 只包含 Windows 平台的 Rollup/Esbuild 可选二进制，因此无法在 Linux 容器中重新生成主客户端生产 bundle。完整工程保留源代码和原有 `client/dist`；在实际目标系统执行正常的 `npm install` 与 `npm --prefix client run build` 即可生成包含新大厅和观战入口的正式前端文件。

## 2026-07-24：InputMsg 越界回归

日志中的故障根因为 `InputMsg.toMouseLen` 写入 255，而协议允许范围为 `[0, 64]`。

新增并通过：

- `npm --prefix server run test:bot-input`
- 对 255、120、64、50、负数、NaN、Infinity、undefined 的数据包序列化测试
- 两个正常协议 Bot 加入真实 Duel 房间并持续运行
- 检查服务端与 Bot 日志，无 `writeFloat`、`out of range`、`Assertation failed`

修复点位于：

- `server/src/bot/inputSafety.ts`
- `server/src/smartBot.ts`
- `server/src/smartBotInputSmokeTest.ts`


## 2026-07-24：视野、沙袋与观战回归

已通过：

- `npm --prefix server run build`
- `npm --prefix server run test:duel-vision`
- `npm --prefix server run test:bot-input`
- `npm --prefix server run test:duel`
- `npm --prefix server run test:duel-lobby`
- `npm --prefix server run test:admin`
- `client/node_modules/.bin/tsc --noEmit`

专项断言包括：

- 背包 15x、当前 1x 时，直接视野保持 1x 大小；
- 内置 Duel 左侧出生点可推断右侧对手出生点；
- 沙袋两侧绕行点方向相反且单次搜索方向稳定；
- 观战者可切换上一位/下一位目标；
- 回合重置后观战者仍为死亡状态、生命值 0，且不在 `livingPlayers`；
- 五局比赛最终比分不包含观战者。

客户端 TypeScript 检查通过。Linux 交付环境无法执行 Vite production bundle，原因是完整工程自带的 `client/node_modules` 为 Windows 平台安装，缺少 Linux Rollup 可选二进制；这不影响用户当前的 Windows/Vite 开发启动方式。
