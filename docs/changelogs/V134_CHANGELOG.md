# V134 修复：1v1 报 "Failed to execute 'json' on 'Response': Unexpected end of JSON input"

## 现象
- 打开/使用 1v1 大厅（房间模式）时，界面直接抛出浏览器原始异常：
  `Failed to execute 'json' on 'Response': Unexpected end of JSON input`。

## 根因
- 客户端 `client/src/ui/duelLobby.ts` 的 `request()` 对 fetch 结果直接调用
  `response.json()`，没有检查响应体是否为合法 JSON；
- 当后端（8001）正在重启 / Vite 代理返回空体 500 / 网关瞬时不可用时，
  `response.json()` 对空响应体抛出 SyntaxError，且该异常没有转换成
  可读错误信息，直接显示在 1v1 界面；
- 相同的裸 `response.json()` 模式也存在于观战大厅（spectateLobby.ts）与
  瞄准练习大厅（aimTrainingLobby.ts），同样可能触发该异常。

## 修复
- 三个大厅文件新增统一的安全解析函数 `parseJsonResponse<T>()`：
  - 先读 `response.text()`；
  - 空响应 → 抛出友好错误 `服务器返回了空响应（status），请稍后再试`；
  - 非 JSON 响应 → 抛出 `服务器返回异常（status），请稍后再试`；
  - 合法 JSON → 正常解析返回。
- 替换调用点：
  - `duelLobby.ts` `request()`（1v1 房间大厅全部动作）；
  - `spectateLobby.ts` `load()` + `watch()`（观战房间列表/加入）；
  - `aimTrainingLobby.ts` `request()`（瞄准练习配置）。
- 错误最终通过各大厅既有的 `errorText()` 显示为中文提示，不再暴露
  浏览器原始异常。

## 服务端核查
- `/api/duel-lobby` 所有业务分支均返回 JSON（returnJson）；
- OPTIONS 预检返回 204 空体属正常 CORS 行为（浏览器自动处理，不会触发
  `.json()`）；
- apiServer 代理层已捕获上游异常并返回 `{err: "1v1大厅服务暂时不可用"}`。

## 验证
- client build（tsc + vite）：PASS；
- server test:duel-lobby：PASS（邀请/独立/镜像/独占武器模式、AI 对手、
  开始与返回流程）；
- 实测 live 接口：POST /api/duel-lobby 正常返回 JSON；
- 三个文件已无裸 `response.json()` 调用。

## 备注
- 触发场景多为开发期后端热重载/瞬时不可用；修复后即使遇到空响应也会
  显示可读提示，不再出现原始 SyntaxError。