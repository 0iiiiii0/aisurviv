# V168 仓库人物界面修正：仅保留一个示范人物，移除换装功能

## 需求

仓库左栏的"人物"应为**示范人物**（展示当前配装的护甲/武器），
不是皮肤/表情/近战换装功能；界面只需要一个人物。

## 实现

### client/storage.html + src/storage.ts + public/css/storage.css
- 删除整块角色换装区：皮肤/近战/表情页签选择器（char-picker）、
  换装预览（char-stage / char-emote / char-melee）及相关样式；
- storage.ts 移除换装逻辑（外观 cookie、选择器渲染、预览染色），
  入口只初始化仓库；
- 页面保留**一个示范人物**（stash-avatar-wrap）：
  CSS 小人 + 头盔/护甲/背包/倍镜装备槽（当前配装图片）+
  主副武器（含弹药数）+ 携带弹药/药品/投掷物统计；
- 右栏仓库物资网格不变。

## 验证

- /storage 页面不再包含 char-picker / char-stage ✓
- 仅一个示范人物（stash-avatar-wrap）✓
- client tsc + vite build：PASS
