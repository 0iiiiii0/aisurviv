# V160 验证记录：What's New! 自动更新

## 验证

1. `node tools/generate-news.mjs` 生成 5 条最新更新 ✓
2. 标题、摘要、版本、日期解析正确 ✓
3. client build 自动执行生成脚本 ✓
4. dist/news.json 随构建输出 ✓
5. 大厅渲染：最近 5 条以「版本号 · 日期 / 标题 / 摘要」展示 ✓
6. 加载失败回退静态内容；后台手动公告不覆盖已生成的更新面板 ✓

## 结论

- What's New! 面板由 changelog 自动驱动，每 5 次更新自动滚动一次；
- 无需手动编辑大厅新闻 HTML。
