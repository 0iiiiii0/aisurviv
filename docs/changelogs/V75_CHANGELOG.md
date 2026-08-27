# V75 移除后台 UI 每个模式的单独"开放/关闭"开关

## 需求

- 去掉后台管理 UI 里一大堆"单独设定每个房间/模式是否开放"的功能。

## 移除内容

### 后端（server/src/adminServer.ts）
- 删除 `AdminService.setModeEnabled()` 方法。
- 删除 `/admin-api/mode-action` 路由。
- `Config.modes[].enabled` 字段保留（匹配 `findGame` 仍需要），但不再提供
  后台切换入口。

### 前端（client/public/admin/）
- `admin.js`：
  - `renderModes()` 不再渲染每个模式的"已开放/未开放"状态徽标与"开放/关闭"
    切换按钮，模式卡片只保留名称/地图/队伍/人数信息；
  - 删除 `setModeEnabled()` 与 `enabled-mode-count`（"X 个公开启用"）更新。
- `index.html`：删除 `enabled-mode-count` 元素。
- `admin.css`：删除 `.mode-toggle-button`、`.mode-status`、`.mode-status-light`、
  `.mode-card-controls` 样式。

### 保留
- 模式下拉框的"（未公开）"后缀（纯信息展示，来自配置文件状态）。
- duel 配置区的"随机模式/房间模式"开关（属于 1v1 配置，非逐个模式开关）。

## 测试

- `adminSmokeTest` 更新：移除 `setModeEnabled` 用例，改为断言该接口已不存在
  （`service.setModeEnabled === undefined`）。
- 服务端/客户端构建通过；`test:admin`、`test:v41-suite`（11 项）及
  V53–V74 全部回归 PASS；`admin.js` 语法检查通过。