# V158 大厅界面整理：左侧 About 区域替换为搜打撤面板

## 需求

大厅界面 UI 混乱：左侧 "About Surviv.io" 介绍区域及其下方的社交分享
按钮占位无意义；将这一整块替换为搜打撤面板。

## 实现

### HTML（client/index.html）
- 左侧栏（#left-column）：删除 `#ad-block-left`（About Surviv.io 文案）
  与 `#social-share-block-wrapper`（社交按钮），替换为搜打撤面板
  （`#extraction-mode-section`：开始对局 / 邀请组队 / 仓库配装）；
- 右侧栏（#right-column）：移除重复的搜打撤面板，仅保留
  What's New 公告（与 pass 隐藏块）。

### CSS（client/css/app.css）
- `.extraction-mode-section` 适配左栏：宽 300px、高 250px
  （与原广告位一致），内容垂直居中，间距加大；
- 原 `#ad-block-left` 的移动端规则迁移到
  `.extraction-mode-section`（小屏 200px 宽自适应高度；
  竖屏 absolute 定位在菜单下方 275×230；小屏竖屏 top 266px + 0.9 缩放）。

### 逻辑（client/src/main.ts）
- 创建队伍时隐藏左侧栏的选择器由 `#ad-block-left` 改为
  `#left-column`，移动端竖屏进入组队界面时搜打撤面板同样隐藏。

## 验证

- client tsc + vite build：PASS
- 搜打撤按钮（开始对局/邀请组队/仓库配装）ID 不变，
  main.ts 的 show() 与点击逻辑不受移动影响；
- 删除元素后 menu.ts/teamMenu.ts 中空选择器操作安全（jQuery 空集）。
