# V258 修复搜打撤邀请组队被自动补员拆队

## 玩家现象

搜打撤通过「邀请组队」进入时，房间能够创建并开始，但同一个邀请房的玩家可能没有被分到同一小队，表现为队友标记/队友关系异常，严重时两名组队玩家进入不同 group。

## 根因

`server/src/game/objects/player.ts` 的 `findFreeGroup()` 在 `autoFill=true` 时会优先复用已有自动补员小队，但整队容量检查被注释：

- TeamMenu 的 2/4 人房使用同一个 join token；
- 第一名玩家可能被塞进一个只剩 1 个空位的已有 AI 小队；
- token 随后记录该 group；
- 第二名队员加入时该 group 已满，只能新建 group；
- 最终同一邀请队伍被拆开。

现有 `extractionTeamEnterSmokeTest` 使用 `autoFill=false`，因此没有覆盖真实 TeamMenu 默认 `autoFill=true` 的路径。

## 修复

- `Group.canJoin()` 同时计算：已加入玩家 + 已预留席位 + 新申请席位；
- 真人共享组队 token 首次选组时，要求该 group 能容纳当前 token 尚未加入的整支队伍；
- 第一名组队玩家进入后，为剩余队友设置 `reservedSlots`；
- 后续自动补员无法抢占这些预留位置；
- 队友依次进入时逐个消费预留席位；
- server-bot 批量 token 仍按单席位处理，避免影响 50v50/AI 批次分组。

## 回归验证

新增 `server/src/extractionTeamAutoFillSmokeTest.ts`：

1. 预先创建两个半满的 Duo 自动补员 AI 小队；
2. 创建 `autoFill=true, playerCount=2` 的真人共享组队 token；
3. P1 加入后必须为 P2 预留 1 个位置；
4. 在 P2 加入前插入一个 racing auto-fill bot，不能抢占 P2 的位置；
5. P2 加入后与 P1 的 `groupId` 必须完全一致，预留归零。

同时修正 `teamMenuSmokeTest.ts` 对 Main Duo 默认关闭的过时 fixture 假设，使测试不依赖 V256+ 的生产 playlist 默认值。
