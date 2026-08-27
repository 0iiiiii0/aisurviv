# V83 去掉 LEGIT / HACKER 的中文名，AI 名称统一小写

## 需求

- 去掉 LEGIT 和 HACKER AI 的中文名。
- LEGIT 改成与其他 AI 一致的小写格式。

## 现状

- 1v1 中 LEGIT / HACKER AI 的玩家名被特殊设置为
  "人类极限[LEGIT]" / "禁忌之力[HACKER]"（大写），
  而其它难度（normal/hard/pro）是 `AI-${difficulty}`（小写）。
- 后台与游戏内 1v1 大厅的难度选项也带中文名：
  "LEGIT · 人类极限"、"HACKER · 禁忌之力"。

## 实现

- server/src/gameServer.ts：
  - `BOT_NAME` 对所有 duel 难度统一使用 `AI-${difficulty}`（小写），
    删除 forbidden/legit 的中文特判名。
  - 相关错误提示由"禁忌之力和人类极限 AI"改为"LEGIT 和 HACKER AI"。
- client/public/admin/index.html（后台）：
  - "LEGIT 人类极限" → "LEGIT"；
  - "LEGIT · 人类极限" → "LEGIT"、"HACKER · 禁忌之力（仅1v1）" → "HACKER（仅1v1）"。
- client/index.html（游戏内 1v1 大厅）：
  - "LEGIT · 人类极限" → "LEGIT"、"HACKER · 禁忌之力" → "HACKER"。

## 效果

- 游戏内 LEGIT / HACKER AI 玩家名与其它 AI 一致：AI-legit / AI-forbidden（小写）。
- 后台与 1v1 大厅的难度选项不再显示中文名。

## 验证

- server 构建（tsc）通过；client 构建（vite）通过。
- 源码与构建产物中不再出现"人类极限 / 禁忌之力"。
- test:v50-room-targets、test:admin、test:duel-lobby、test:v41-suite（11 项）全部 PASS。