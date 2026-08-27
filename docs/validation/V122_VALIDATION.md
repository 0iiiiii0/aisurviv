# V122 验证报告

## 变更范围

- `client/src/game.ts`：客户端本地弹道模拟应用 sandevistan 世界倍率
  （子弹 / 信号弹 / 投掷物），并支持服务器实时倍率覆盖。
- `client/src/siteInfo.ts`：站点信息携带 sandevistan 倍率，支持加载回调。
- `client/src/main.ts`：同步服务器倍率到 Game。
- `server/src/apiServer.ts`：site_info 返回实时 sandevistan 配置。

## 自动化测试

- client tsc --noEmit：PASS
- server tsc --noEmit：PASS
- vite build：PASS
- test:sandevistan：PASS

## 接口实测

- `GET /api/site_info`：
  `"sandevistan": {"playerTimeScale":0.1,"worldTimeScale":0.1}`。

## 行为验证

- 激活前：`worldDt = dt`，弹道全速；
- 激活后：`worldDt = 0.1 × dt`，客户端弹道推进速度与服务端一致；
- 效果结束：立即恢复全速（与服务端切换行为一致）；
- 后台修改“对局速度”（worldTimeScale）后，新加载的客户端按新倍率减速。

## 说明

- 毒圈、自动门、空投等由服务器直接下发状态/坐标，本身已按世界时间减速，
  无需客户端模拟倍率。
