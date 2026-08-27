# V91 后台 UI 反馈（4 条）

## 需求（浏览器反馈）

1. "创建纯 AI 1v1"工具卡垂直空间占太多，压缩高度。
2. 删除 1v1 配置面板中的"随机1v1模式"开关。
3. 删除 1v1 配置面板中的"1v1房间模式"开关。
4. 2077·斯安威斯坦 特殊模式目前只开放 Normal 单人。

## 实现

### 1. 纯 AI 1v1 卡片压缩（admin.css）
- 减小 heading / fieldset / label / actions 的间距与内边距，整体高度明显降低。

### 2/3. 删除 1v1 面板内的两个开关
- `client/public/admin/index.html`：移除"随机1v1模式"与"1v1房间模式"
  两个 toggle 卡片。
- `client/public/admin/admin.js`：移除对应元素引用、
  renderDuelConfig 中的赋值、以及两个 change 监听器。
- 1v1随机 / 1v1房间 的开关统一由"模式配置"顶部**特殊模式组**的
  "1v1 随机"/"1v1 房间"卡片承载（写入同一份 duel draft）。

### 4. 2077 只开放 Normal 单人
- 特殊模式组中"2077 · 斯安威斯坦"卡片只切换 sandevistan **单人**规格
  （sandevistan:solo），不再批量开关双人/四人；
  状态徽标/开放数也基于单人规格。

### 测试
- `v50UnifiedTargetDuelAdminSmokeTest` 更新：后台不再出现
  duel-random-mode-enabled / duel-room-mode-enabled 元素与监听。
- server / client 构建通过；`test:v50-room-targets`、`test:admin`、
  `test:v41-suite`（11 项）全部 PASS。