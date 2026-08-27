# V92 斯安威斯坦 HUD 技能槽：赛博朋克 2077 风格化

## 需求

- 客户端 HUD 采用高饱和荧光黄色背景（#FAFE32）；
- 中央排列细长未来科技风数字 "2077"；
- 数字浅青蓝色（#6EC5BE）半透明柔和质感，与黄底强冷暖对比；
- 数字边缘轻微抗锯齿过渡 + 淡化高光（#A0DCC8）；
- 数字之间极细浅青蓝水平连接线（#5ABEB4），电子线路/数字终端感。

## 实现（client/index.html + client/css/game.css）

- 技能槽 `#ui-sandevistan-skill`：
  - 背景改为荧光黄 #FAFE32，青蓝描边 + 柔和外发光；
  - 原 "S" 圆图标替换为 `#ui-sandevistan-icon` 数字徽章，内部
    `<span>2</span><span>0</span><span>7</span><span>7</span>`；
  - 数字样式：等宽细长、800 字重、青蓝半透明（rgba(110,197,190,.88)）、
    双层青白高光 text-shadow（#A0DCC8）、抗锯齿；
  - 数字之间 `::after` 生成 6×1px 极细水平连接线（#5ABEB4）；
  - 激活时徽章高亮发光（box-shadow + 背景提亮）；
- 状态文字/充能条改深青绿（#1c4a45 / #143a35），保证黄底对比可读；
- 充能条改为青蓝渐变（#2f9b92 → #5ABEB4）。

## 测试

- client 构建（vite）通过；server 构建通过；
- `test:sandevistan`、`test:v41-suite`（11 项）全部 PASS。