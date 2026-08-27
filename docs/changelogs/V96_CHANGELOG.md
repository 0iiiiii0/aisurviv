# V96 主界面模式按钮：2077·斯安威斯坦 赛博朋克风格

## 需求

- 2077 风格（荧光黄 #FAFE32 背景 + 中央细长青蓝 "2077" 数字 +
  数字间极细青蓝连接线）应用到**游戏主界面选择模式的 UI**，
  而非技能槽。

## 实现

- `shared/defs/maps/sandevistanDefs.ts`：desc 增加
  `buttonCss: "mode-button-sandevistan"`，供主界面按钮样式钩子。
- `client/src/siteInfo.ts`：主界面生成 2077 模式按钮时，
  在按钮前追加 `2 0 7 7` 数字徽章（4 个 `<i>` + CSS 连接线）。
- `client/css/app.css`：`.mode-button-sandevistan` 样式——
  - 荧光黄背景 #FAFE32、深青绿文字、青蓝描边与外发光；
  - 徽章数字浅青蓝 #6EC5BE 半透明、双层青白高光 #A0DCC8、
    抗锯齿、等宽细长；
  - 数字之间由 5×1px 极细青蓝水平连接线 #5ABEB4 串联。

## 测试

- client / server 构建通过；
- `test:sandevistan`、`test:v41-suite`（11 项）全部 PASS。