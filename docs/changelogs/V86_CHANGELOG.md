# V86 后台：特殊模式总开关栏位（50v50 / 1v1随机 / 1v1房间 / 2077）

## 需求

- 把特殊模式的开关（50v50、1v1随机、1v1房间、2077·斯安威斯坦）
  放在后台"模式配置"模块顶部的一个栏位里，位于其他普通模式上面。

## 实现

### 后台 UI（client/public/admin/）
- `index.html`：模式配置（PLAYLISTS）顶部新增"特殊模式开关"栏位
  （special-modes-panel），4 张开关卡片并排：
  - **50v50**（faction 阵营模式）；
  - **2077 · 斯安威斯坦**（sandevistan 植入体模式，3 个队伍规格统一开关）；
  - **1v1 随机**（主菜单公开随机匹配）；
  - **1v1 房间**（邀请码 / 房间号 / AI 对手大厅）。
- `admin.js`：
  - 新增 `syncSpecialModeSwitches()`，每次渲染后同步 4 个开关状态
    （50v50/2077 取自 modes 的 enabled，1v1 取自 duel 配置）；
  - 50v50 / 2077 开关点击复用 `setModeEnabled`（与模式网格开关一致，
    50v50 控制 faction，2077 统一控制全部 sandevistan 队伍规格）；
  - 1v1随机 / 1v1房间 开关与现有 `duel-random-mode-enabled` /
    `duel-room-mode-enabled` 双向同步（点击任一，另一个同步，共用一份 draft）。
- `admin.css`：special-modes-panel / special-mode-card 样式（响应式 4→2→1 列）。

## 测试

- 客户端构建（vite）通过；服务端构建通过。
- `test:v50-room-targets`、`test:admin`、`test:all-modes`、
  `test:v41-suite`（11 项）全部 PASS。

## 说明

- 服务端无改动：50v50 / 2077 走现有 mode-action 接口，1v1 走现有 duel 配置。
- 普通模式的原有开关仍保留在模式网格中，与特殊栏位状态实时一致。