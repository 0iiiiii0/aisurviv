# V159 验证记录：公告栏位置还原

## 验证

1. `#right-column` 不再使用 flex 行布局 ✓
2. `#news-wrapper` 恢复 display:block；`#news-block` 保持
   300px 宽 + margin-left:30px ✓
3. 移动端竖屏隐藏右栏规则不受影响 ✓
4. 构建：client tsc + vite build PASS ✓

## 结论

- What's New! 公告已回到最初的位置与布局；
- 左侧搜打撤面板、中央模式菜单保持不变。
