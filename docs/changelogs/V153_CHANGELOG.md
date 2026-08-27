# V153 搜打撤撤离点使用自定义图标标记

## 需求

小地图上的撤离点标记改用用户提供的绿色箭头图标。

## 实现

### 图标资源（client/public/img/gui/extraction-point.png）
- 用户原图 1254×1254（深色背景 + 绿色箭头图标，无透明通道）；
- 用颜色键抠图：按与背景色（约 RGB 3/7/7）的欧氏距离生成 alpha，
  背景变透明、绿色线条保留、抗锯齿边缘自然过渡；
- 高质量双三次缩放到 512×512（约 100 KB），图标圆环/箭头细节完整。

### 小地图标记（client/src/ui/ui.ts）
- `updateExtractionMapSprite` 的纹理由 `player-map-inner.img`（绿点）
  改为 `img/gui/extraction-point.png`（用户图标）；
- `tint` 改为白色保留图标原色；`scale` 调整为 0.1（约 50px 显示，
  比原绿点更醒目），保留脉冲与置顶 zOrder。

### 世界内渲染（client/src/game/game.ts）
- 移除所有 5 个撤离点位的小白点绘制，世界内只显示当前开启点
  （离玩家最远）的绿色脉冲圆环，与「只显示开启的撤离点」要求一致。

## 验证

- client `tsc --noEmit && vite build`：PASS
- 新图标已复制到 `client/dist/img/gui/extraction-point.png`
- 非搜打撤模式不创建/不显示撤离点标记（逻辑不变）
