# V127 服务器崩溃后自动归还局内玩家装备

## 需求

- 如果服务器崩溃，当前局内玩家的全部装备直接放回仓库。

## 实现

### 待结算配装记录（server/src/stash/stashManager.ts）
- 进局发放（`grantLoadout`）时把从仓库扣掉的装备快照记录为
  `pendingGrants`（枪械按把数/双持、近战、弹药=弹匣+备用、
  药品/投掷物、护甲/倍镜），随主仓库文件原子持久化。
- `clearPendingGrant(name)`：对局正常结算后清除。
- `recoverPendingGrants()`：把未结算的配装全额归还仓库并清除。

### 结算钩子
- 撤离成功（`extractionSystem.extract`）：物资已入库 → 清除待结算。
- 阵亡（`player.kill`）：装备掉落不再归还 → 清除待结算。
- 断线/离开（`playerBarn.removePlayer`）：清除待结算。

### 崩溃恢复（server/src/gameServer.ts）
- 服务器启动（`init`）时调用 `recoverPendingGrants()`：
  上次崩溃遗留的未结算配装自动归还，并记录日志。

## 说明

- 只保护"带入的配装"；局内拾取的新物资在崩溃时无法找回。
- 阵亡/撤离/断线属于正常结算，不会在崩溃恢复时重复归还。

## 验证

- 新增崩溃恢复回归测试（`test:extraction` 3c）：
  - 发放后崩溃 → 重启归还枪+弹药（含弹匣）全额恢复；
  - 正常死亡清除后崩溃 → 不归还。
- `test:extraction`、`test:admin`、`test:all-modes`、`test:duel` 通过；
  server `tsc` 通过。
