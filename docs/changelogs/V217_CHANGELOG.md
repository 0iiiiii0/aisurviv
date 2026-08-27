# V217 统一仓库身份与入局身份

## 问题

仓库使用独立 `surviv_stash_name` Cookie，入局使用大厅 playerName，
可能"给 A 配装、以 B 入局"（配装与入局身份不一致）。

## 修复（client/src/storage.ts）

- 仓库身份**优先使用大厅 playerName**（与入局同一 config 来源：
  localStorage `surviv_config`）；
- playerName 为空时回退仓库 Cookie；
- 每次打开仓库将身份同步写入 Cookie（保持既有机制）。

## 验证

- 大厅设置 playerName 后打开 /storage：自动以该名字加载仓库 ✓
- 入局（game.ts 用 config.playerName）与仓库身份一致 ✓
- client tsc + vite build：PASS
