# V160 What's New! 自动展示最近 5 次重要更新

## 需求

每 5 次更改后自动更新大厅的 What's New! 公告，展示最近五次比较重要的
更新（不再需要手动维护 2019 年的静态新闻）。

## 实现

### 生成脚本（tools/generate-news.mjs）
- 扫描 `docs/changelogs/V*_CHANGELOG.md`，按版本号倒序取最新 5 条；
- 解析每条：版本号（文件名）、标题（首行）、日期（文件修改时间）、
  摘要（首个 `## ` 小节下的段落）；
- 输出 `client/public/news.json`（每次构建自动重新生成）。

### 构建集成（client/package.json）
- `build` 前自动执行 `npm run gen:news`；
- 另有 `npm run gen:news` 可手动刷新。

### 客户端渲染（client/src/newsPanel.ts + main.ts + siteInfo.ts）
- 大厅初始化时 fetch `news.json`，渲染到 `#news`：
  「What's New!」+ 最近 5 条（版本号 · 日期 / 标题 / 摘要）；
- 渲染成功后标记 `data-source="news-json"`，
  `siteInfo.renderAnnouncement` 不再覆盖；
- 文件加载失败时静默回退到 DOM 中已有的静态/公告内容。

## 验证

- 生成脚本输出 5 条（当前 V154–V159，含标题与摘要）✓
- client tsc + vite build：PASS（build 自动执行 gen:news）✓
- dist/news.json 随构建输出 ✓
- 每发布 5 个新版本后，面板自动滚动为最新 5 条更新 ✓
