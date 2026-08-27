# V147 修复：访客摘要文字被截断（武器模式/激素只显示一个字）

## 现象
- 访客只读摘要中「武器模式」「激素」明明有空间，却只显示一个字+省略号。

## 根因
- 摘要卡片此前用 grid 自动布局：`grid-template-columns: 22px minmax(0,1fr)`；
- 无图片的行（武器模式、激素）里，`strong` 被自动放进第一个 22px 轨道
  （图片位），被压缩到约一个字宽 → 省略号。

## 修复（client/css/duel-lobby.css）
- `.duel-lobby-common-summary-row` 从 grid 改为 **flex + wrap**：
  - 标签（span）`flex-basis: 100%` 独占一行；
  - 图片（如有）与数值（strong）在同一行；无图片时 `strong` 独占整行，
    `flex: 1 1 auto` 完整展示。

## 验证（headless Edge 1280×800）
- 武器模式「各自选择」完整显示（scrollWidth == clientWidth）✅
- 激素「开启 · 初始 100」完整显示 ✅
- 头盔/防弹衣/倍镜带图片行完整显示 ✅
- 所有行 truncated = false ✅
- client build：PASS ✅