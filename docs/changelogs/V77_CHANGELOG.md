# V77 恢复"房间是否开放"开关 + 移除每模式 AI 进入延迟

## 需求

1. 重新加入后台 UI 里"单独设定每个房间/模式是否开放"的开关（V75 曾移除）。
2. 去掉后台 UI 里每模式单独设定的"AI 进入延迟"（AI 加入间隔）。

## 实现

### 恢复"是否开放"开关（回退 V75）
- 后端（server/src/adminServer.ts）：
  - 恢复 `AdminService.setModeEnabled()`（校验模式、禁止作用于 duel、持久化）；
  - 恢复 `/admin-api/mode-action` 路由。
- 前端（client/public/admin/）：
  - `admin.js`：`renderModes()` 恢复每模式"已开放/未开放"徽标与"开放/关闭"
    切换按钮、`setModeEnabled()`、`enabled-mode-count`（"X 个公开启用"）；
  - `index.html`：恢复 `enabled-mode-count` 元素；
  - `admin.css`：恢复 `.mode-toggle-button` / `.mode-status` /
    `.mode-status-light` / `.mode-card-controls` 样式。

### 移除每模式 AI 进入延迟
- 后端快照：`toBotAutoFillSnapshot().modes` 删除每模式 `joinIntervalMs`
  （AI 加入间隔始终是全局统一值，每模式字段纯冗余）。
- 前端：bot 自动补入网格的每个模式卡片不再显示"AI间隔与全局统一"延迟行，
  只保留补齐目标。
- `index.html`：修正过时说明"每个模式仍可单独设置AI加入间隔"→
  "AI加入间隔为全局统一值，不再按模式单独设置"。
- 顺带修复 V76 新增"单人/双人/四人补齐目标"输入标签的乱码。

## 测试

- `adminSmokeTest`：恢复 `setModeEnabled` 用例（duel 拒绝、potato 开关往返、
  持久化计数、非法入参）；移除每模式 `joinIntervalMs` 快照断言。
- `test:v50-room-targets`：更新为断言每模式不再暴露 `joinIntervalMs`。
- 服务端/客户端构建通过；`test:admin`、`test:v41-suite`（11 项）及
  V53–V76 全部回归 PASS。