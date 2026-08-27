# V149 1v1 复制功能增强：失败兜底 + 成功 Toast 提示

## 需求
- 1v1 复制房间号/邀请链接部分情况无法复制（无任何反馈）；
- 复制成功要给出明确提示。

## 实现（client/src/ui/duelLobby.ts + index.html + duel-lobby.css）

### 1. 复制失败兜底（三级）
1. `navigator.clipboard.writeText`（标准 API）；
2. 失败 → 隐藏 textarea + `document.execCommand("copy")` 回退
   （覆盖非 HTTPS 局域网访问等剪贴板 API 不可用的情况）；
3. 仍失败 → 弹出内容对话框提示手动复制（`window.prompt`）；
4. 全部不可用 → 显示错误提示「复制失败：浏览器禁止自动复制，请手动复制」。

### 2. 成功 Toast 提示
- 新增独立 Toast 元素（`#duel-lobby-toast`，绝对定位在弹窗底部）：
  - 复制成功显示「房间号已复制」/「邀请链接已复制」；
  - 1.8 秒后自动消失；
  - 不受大厅轮询刷新影响（原状态文字会被轮询覆盖，Toast 不会）。

## 验证（headless Edge）
- 成功路径（stub 剪贴板）：Toast 显示「邀请链接已复制」✅
  经过一次轮询后 Toast 仍在 ✅，2.3 秒后自动隐藏 ✅
- 失败路径：显示「复制失败：浏览器禁止自动复制，请手动复制」✅
- client build：PASS ✅