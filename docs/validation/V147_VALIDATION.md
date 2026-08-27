# V147 验证记录：摘要文字截断修复

## 验证项
1. 根因：无图片行 strong 落入 22px 图片轨道（grid 自动布局）✅ 定位
2. 修复：flex 布局，无图片时 strong 独占整行 ✅
3. headless Edge 实测：
   - 武器模式「各自选择」scrollW==clientW==257 ✅
   - 激素「开启 · 初始 100」完整 ✅
   - 带图片行同样完整 ✅
   - truncated 全部 false ✅
4. client build：PASS ✅
5. 环境 8001/3000 正常 ✅

## 结论
- 摘要文字不再截断，多列布局保持。