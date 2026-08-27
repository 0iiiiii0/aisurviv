# V123 验证报告

## 变更范围

- `client/public/admin/admin.js`：2077 卡片整行显示；减速配置区重构
  （独立字段块 + 恢复默认 + 效果摘要）。
- `client/public/admin/admin.css`：`.sandevistan-config-card` /
  `.sandevistan-field` / `.sandevistan-actions` / `.sandevistan-summary`
  样式与响应式布局。
- `server/src/apiServer.ts`：新增 `/api/sandevistan/config` 公开接口。
- `client/src/game.ts`：2077 地图内每 5 秒同步服务器减速倍率。

## 自动化测试

- admin.js `node --check`：PASS
- client tsc --noEmit：PASS
- server tsc --noEmit：PASS
- vite build：PASS

## 接口实测

- `GET /api/sandevistan/config`：`{"playerTimeScale":0.1,"worldTimeScale":0.1}`；
- 后台保存 0.15/0.08 后接口立即返回新值；恢复 0.1/0.1 后同步恢复。

## 说明

- 玩家速度（playerTimeScale）作用于其他玩家/AI 的移动（服务端权威）；
- 对局速度（worldTimeScale）作用于子弹/信号弹/投掷物/毒圈/地图交互，
  客户端本地弹道每 5 秒跟随服务器实时倍率，正在进行的对局也会变化。
