# V146 访客只读摘要多列布局

## 需求
- 访客视图的只读图片+文字摘要不要一行一个，一行放多个。

## 实现（client/css/duel-lobby.css）
- `.duel-lobby-common-summary` 改为 3 列网格：
  `grid-template-columns: repeat(3, minmax(0, 1fr))`；
- 每个摘要项变成紧凑卡片：标签在上、图片+数值在下（与公共规则表单
  同款卡片样式）；
- 移动端（≤760px）媒体查询加入该元素，自动回退为单列。

## 验证（headless Edge）
- 桌面视口（1280×800）：`grid-template-columns` 为三列
  （277px × 3），前三项（武器模式/激素/头盔）同一行并排 ✅
- 窄视口（750px）：命中媒体查询，单列（移动端预期行为）✅
- client build：PASS ✅