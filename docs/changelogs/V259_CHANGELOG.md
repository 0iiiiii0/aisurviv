# V259 — 僵尸困难模式核爆成就自动发放修复

## 问题

生产环境使用 `GameProcessManager`（worker/fork 多进程房间）时，僵尸大厅请求的
`zombieDifficulty` 没有传入新创建的房间：

```ts
createServerGameConfig(mode)
```

因此即使客户端选择 `hard`，worker 中的 `Game.config.zombieDifficulty` 仍回退为
`normal`。核爆成就 `zombie_nuclear_hard` 的权威条件要求 `hard + Solo`，导致核爆、
地堡存活都正常，但成就判定静默失败。

此外，多进程匹配器没有按僵尸难度隔离已存在房间；仅修复建房参数后，困难玩家仍
可能被放入已有普通房间。

## 修复

- `GameProcessManager.findGame()` 创建房间时传入请求的 `zombieDifficulty`。
- `GameProcess` 保存房间难度快照。
- `Game.updateData()` 将实际 `zombieDifficulty` 回报给父进程。
- 多进程匹配按 `simple / normal / hard` 隔离僵尸房间。
- 新增 `zombieProcessDifficultySmokeTest.ts`，覆盖生产建房配置和难度隔离。

## 成就规则不变

核爆成就仍只授予：

1. 僵尸模式 `hard`；
2. `Solo`；
3. 玩家已登录账号；
4. 核爆瞬间仍存活并处于地堡层。

## 验证

- Server `tsc --noEmit`: PASS
- 生产难度匹配回归测试: PASS
- 核爆成就授予 + `AchievementUnlocked` 通知: PASS
- 实际 `worker_threads` 房间创建：请求 `hard` 后父进程收到的房间快照仍为 `hard`: PASS
