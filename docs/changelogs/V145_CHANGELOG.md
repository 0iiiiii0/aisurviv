# V145 启动器：日志实时滚动 + 炸服自动重启

## 需求
- 服务器炸服后当前无任何反应（ts-node --watch 在子进程崩溃后只打印
  "Failed running" 并等待文件变更，端口一直掉线）；
- 启动器需要滚动播放日志方便 debug；
- 添加炸服自动重启功能。

## 实现（start-surviv.ps1）
1. **日志实时滚动**
   - 新增 `Show-JobOutputLive`：持续排空 job 输出缓冲区并带 `[server]` /
     `[client]` 前缀打印；启动等待阶段和维护阶段都实时滚动。
2. **炸服自动重启**
   - 启动成功后进入维护循环：
     - 每 ~400ms 探测 8001/3000；
     - 端口失联（job 死亡或 ts-node 子进程崩溃）连续 ~2.4s →
       自动清理（Stop-OwnedJob + Stop-PortOwner + Wait-PortFree）→
       重新启动对应服务 → 等待端口恢复（最长 60s，期间日志继续滚动）；
     - 恢复后打印 `[AUTO-RESTART] 服务器已恢复。`；
     - 客户端（vite 3000）同样受保护。
   - 重启失败会持续监视并自动重试。
3. **退出方式**
   - 按 Enter 或 q 停止所有服务；关闭窗口/Ctrl+C 同样清理（原有机制保留）。
4. 代码结构：job 启动抽成 `Start-SurvivServerJob` / `Start-SurvivClientJob`；
   交互检测抽成 `Test-UserQuit`（无交互控制台时自动忽略按键，Ctrl+C 仍有效）。

## 编码修复
- start-surviv.ps1 新增中文说明后因文件无 BOM 被 PowerShell 按 GBK 读取，
  中文引号被吞导致语法错误；已补 UTF-8 BOM，解析通过。

## 验证（实测）
1. 启动器启动：8001/3000 正常，日志实时滚动（server/client 前缀）✅
2. **模拟炸服**：强制杀掉 8001 子进程 →
   - `Failed running 'src/devServer.ts'` 出现在滚动日志中 ✅
   - `[AUTO-RESTART] 服务器无响应（8001 未监听），正在重启...` ✅
   - 新服务器 `Listening on [::]:8001` → `[AUTO-RESTART] 服务器已恢复。` ✅
   - 8001 恢复监听，新服务器正常 tick ✅
3. 客户端自动重启逻辑同构（未破坏启动流程）✅
4. PowerShell 语法解析通过 ✅