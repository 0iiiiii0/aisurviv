# V134 验证记录：1v1 JSON 解析异常修复

## 验证项
1. client build（tsc + vite）：PASS
2. server test:duel-lobby：PASS
3. 代码审查：三个大厅文件（duelLobby / spectateLobby / aimTrainingLobby）
   已无裸 response.json() 调用，全部经 parseJsonResponse 防护
4. live 接口：POST /api/duel-lobby 返回合法 JSON；OPTIONS 204 正常

## 行为
- 后端空响应/非 JSON 响应时，界面显示
  「服务器返回了空响应（status），请稍后再试」/「服务器返回异常（status）」
  替代浏览器原始 SyntaxError。
- 正常路径行为不变。

## 结论
- 修复完成。玩家刷新页面（Ctrl+F5）后生效。