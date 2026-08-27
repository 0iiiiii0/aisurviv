# V113 仓库弹药存储上限提升到 99999

## 需求

- 子弹上限 99999。

## 实现（server/src/stash/stashManager.ts）

- 拆分常量：弹药仓库上限 `STASH_AMMO_CAP = 99999`；
  医疗用品（药品/增益）保持 `STASH_MEDICAL_CAP = 999`。
- 仓库仍是独立存储，局内协议（9-bit/510、无限哨兵、protocolVersion）
  完全未改动；进局携带/发放仍按背包容量和 510 截断。

## 验证

- 实测：9mm 可存到 99999；绷带/医疗包保持 999；
  配装携带 9mm 50000 + 大包 → 发放仍截断为 420。
- `test:extraction`、`test:all-modes` 通过；server `tsc` 通过。
- 文档 `docs/STASH_CAPACITY.md` 已同步。
