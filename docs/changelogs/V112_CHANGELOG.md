# V112 仓库存储与局内协议解耦：弹药/医疗上限提升到 999

## 需求

- 仓库用独立存储，不受局内协议（9-bit/510）限制，不影响其他模式。

## 实现（server/src/stash/stashManager.ts）

- 新增 `STASH_STACK_CAP = 999`：弹药/药品/增益的仓库存储上限从 510
  提升到 **999**。
- 仓库是服务端独立存储（JSON），存多少都不影响局内网络协议；
  **进局发放仍按 min(配装携带量, 仓库可用量, 背包容量, 510) 截断**，
  因此其他模式的协议（updateMsg 9-bit、infiniteCount 哨兵、protocolVersion）
  完全未改动。
- 枪械/护甲/倍镜 99、近战/投掷物 510 保持不变。

## 验证

- 场景：仓库 12gauge/绷带/医疗包可存到 999；
  配装携带 12gauge 200 + backpack03 → 仍按背包容量截断为 90。
- `test:extraction`（含解耦断言：弹药可存 560 > 510）通过。
- `test:admin`、`test:all-modes`、`test:duel`、`test:loot-capacity` 通过。
- server `tsc` 通过；文档 `docs/STASH_CAPACITY.md` 已同步。
