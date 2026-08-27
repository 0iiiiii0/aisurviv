# V164 独立全屏仓库页面 /storage + 角色展示（皮肤/近战/表情）+ 武器图修复

## 需求

- 仓库改为独立全屏页面（如 http://localhost:3000/storage）；
- 页面包含 surviv 式人物展示：更换皮肤、近战、表情；
- 修复仓库中武器没有图片显示的问题。

## 实现

### 独立页面（client/storage.html + src/storage.ts + public/css/storage.css）
- vite 多页构建（index.html + storage.html），`/storage` 路由
  302 → `/storage.html`（dev 与 preview 均生效）；
- 页面布局：顶部标题 + 玩家名（cookie 身份）+ 返回游戏；
  左侧角色展示区，右侧仓库（装备小人 + 物资网格）；
- 大厅「仓库配装」按钮改为直接跳转 `/storage`。

### 角色展示（storage.ts）
- 三个页签：**皮肤**（OutfitDefs 色板）、**近战**（MeleeDefs 图片）、
  **表情**（EmotesDefs 图片）；
- 中央预览：CSS 小人按所选皮肤 tint 染色、头顶表情气泡、
  手持近战武器图；
- 外观选择存 `surviv_storage_look` cookie，下次打开自动恢复。

### 武器图片修复（extractionStashUi.ts + CSS）
- 弹药改用专用图标 `img/emotes/ammo-<口径>.svg`（9mm/762mm/…）；
- 枪械贴图为细长分块图：改为 `height:76~92px; width:auto` 纵向展示，
  不再缩成看不见的细条；无独立贴图的枪回退通用枪图
  （gun-long-01.svg）；
- 仓库渲染逻辑抽成共享模块（extractionStashUi 导出），
  游戏内弹窗与独立页面共用。

## 验证

- `/storage` 302 → `/storage.html` 200；storage.ts / storage.css 可访问 ✓
- 多页构建输出 storage.html 与独立 chunk ✓
- stash API（含投掷物）回归通过 ✓
- server tsc / client tsc + vite build / test:extraction：PASS
