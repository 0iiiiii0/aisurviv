# V224 删除 2077（斯安威斯坦）模式的双人与四人

## 需求
- 2077 模式只保留单人，删除双人和四人对局类型。

## 实现（server/src/config.ts）
- `DefaultModes` 中 `sandevistan` 不再使用 `battleRoyaleModes`（生成
  solo/duo/squad 三个播放列表），改为**只生成单人**：
  ```ts
  { mapName: "sandevistan", title: "斯安威斯坦", teamMode: TeamMode.Solo, enabled: false }
  ```
- 模式目录按 `mapName:teamMode` 键对齐（`normalizeModeCatalogue`），
  删除 duo/squad 后其余模式（搜打撤、Potato 春季、Woods 雪地等）的
  开关状态不会错位。

## 兼容说明
- 服务端/客户端组队菜单（teamMenu）原本就已排除 sandevistan，不受影响；
- 后台「特殊模式」快捷开关只看 sandevistan 单人（`teamMode === 1`），不受影响；
- 本地 `survivio-config.json` 中残留的 sandevistan duo/squad 旧条目
  启动时会被目录重建忽略，下次保存模式配置时自动清理。

## 验证
- 启动后 `Config.modes` 中 sandevistan 仅剩 `teamMode: 1`（单人）；
- server `tsc`：PASS；
- `test:all-modes`（更新播放列表计数断言：sandevistan 按单播放列表计算）、
  `test:sandevistan`、`test:admin`、`test:v50-room-targets`：PASS。
