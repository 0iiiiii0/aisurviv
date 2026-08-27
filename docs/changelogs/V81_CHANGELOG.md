# V81 后台 UI 整体优化

## 需求

- 整体优化管理后台（client/public/admin/）的视觉、布局与交互。

## 实现

### 视觉系统（admin.css 追加 V81 一节）
- 暗色滚动条（webkit + Firefox），与整体主题统一。
- 键盘焦点环 `:focus-visible`，改善无障碍体验。
- 自定义 select 下拉箭头（SVG 背景），替代系统默认箭头。
- 输入框/下拉/文本域 hover 态；卡片（指标卡、模式卡、工具卡、AI 卡、
  武器卡）hover 微上浮；表格行 hover 高亮；按钮按压态。
- 宽屏（≥1460px）内容区最大宽度 1360px 居中。
- toast 通知加成功/错误图标与前缀色条。

### 模式配置（index.html + admin.js + admin.css）
- 47 个模式按地图分组渲染：组头显示地图名 + "X 开放 / N 个模式"，
  点击组头折叠/展开（折叠状态存 localStorage）。
- 新增工具条：搜索框（按地图/名称/队伍过滤）、"仅显示已开放"复选框、
  全部展开/全部收起按钮、地图组与模式计数；无匹配时显示空态提示。

### 房间管理（index.html + admin.js）
- 房间表格上方新增筛选下拉：全部房间 / 仅可加入 / 仅已锁定，
  并显示当前可见房间数。

### 顶部栏（index.html + admin.js）
- 新增"自动刷新"下拉：关闭 / 5秒 / 10秒 / 30秒；
  选择后立即生效并记忆到 localStorage，手动刷新按钮保留。

## 测试

- admin.js 语法检查（node --check）通过。
- 客户端构建（tsc --noEmit && vite build）通过；服务端构建通过。
- `test:v50-room-targets`（校验 admin UI 关键结构）PASS。
- `test:v41-suite`（11 项）全部回归 PASS。