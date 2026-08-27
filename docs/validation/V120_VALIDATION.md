# V120 验证报告

## 变更范围

- `client/public/admin/index.html`：新增 1 秒 / 2 秒档位，默认 2 秒。
- `client/public/admin/admin.js`：
  - 删除隐藏的固定 5 秒刷新定时器（`state.timer`），刷新频率唯一由下拉框控制；
  - 存储键升级为 v2，默认 2 秒。

## 自动化测试

- admin.js 语法检查：PASS
- vite build：PASS

## 运行验证

- dev server 返回的 HTML/JS 已包含新档位与默认值；
- 未发现残留的 `state.timer` 引用。

## 说明

- 若用户之前在旧键下保存过刷新间隔，v2 键会重新应用默认 2 秒；
  此后在下拉框手动选择会写入新键并被尊重。
