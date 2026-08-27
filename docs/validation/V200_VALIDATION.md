# V200 验证记录：相机聚焦对齐

## 验证

1. modal 元素位于画布内（相机聚焦 = 画布）✓
2. 玩家渲染到画布中心 ✓
3. 诊断日志可辅助定位（playerPos / texValid / camPos）✓
4. 构建：client tsc + vite build PASS ✓

## 结论

- 人物"消失"源于渲染位置偏移，已对齐画布。
