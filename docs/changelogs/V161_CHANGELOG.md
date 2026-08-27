# V161 修复：搜打撤仓库配装无反应 + 邀请组队 Failed creating team

## 问题 1：仓库配装点击无反应

### 根因
- `#extraction-stash-panel`（仓库面板）**完全没有任何 CSS 样式**：
  点击后面板以裸 `<div>` 出现在文档流末尾，用户看不到界面，表现为"无反应"。

### 修复（client/css/app.css）
- 为仓库面板补齐完整样式：屏幕居中弹窗（深色底 + 青绿描边）、
  玩家名/物品输入框、保存/关闭/添加按钮、物品 chips、配装编辑器
  （select / number 输入），移动端 92vw 自适应。

## 问题 2：邀请组队 Failed creating team

### 根因
- 服务端 `teamMenu` 创建房间时硬编码检查
  `Config.modes[1]/[2]`（普通双人/四人）是否启用；后台关闭这两个
  playlist 后，**所有模式**（含搜打撤 duo）的邀请组队都被拒绝；
- `addRoom`/`modifyRoom` 沿用旧的内部编码（1=双人、2=四人），与
  现代 playlist 索引体系不符：搜打撤 duo（索引 39）会被换算成负数，
  房间无法正确开始对局。

### 修复
- 服务端（server/src/teamMenu.ts）：
  - 创建队伍检查改为"是否存在任何启用的组队 playlist
    （duo/squad，含搜打撤 duo）"；
  - `addRoom` 按启用的 duo/squad playlist 索引解析房间模式
    （保留请求索引，无效时回退到第一个启用项），
    `maxPlayers` 直接取 playlist 的 teamMode（2/4）；
  - `modifyRoom` 同步按 playlist 索引计算人数上限。
- 客户端（client/src/ui/teamMenu.ts）：
  - 双人/四人按钮绑定到第一个启用的 duo/squad playlist 索引；
  - 按钮选中/可用判断改为 playlist 索引语义，
    无可用四人模式时隐藏四人按钮；
  - 选中态按"当前房间模式是否为 duo/squad"判断，
    兼容邀请组队直达搜打撤 duo 房间。

## 验证

- `/team_v2` 创建房间：成功返回 state，
  `gameModeIdx=39`（搜打撤 duo）保留、`maxPlayers=2` ✓
- `/api/extraction/stash` 经 3000 代理与 8001 直连均正常 ✓
- server tsc / client tsc + vite build：PASS
- test:extraction / test:admin：PASS
