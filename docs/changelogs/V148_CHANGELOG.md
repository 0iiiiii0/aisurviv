# V148 删除遗留启动器 START_V45.cmd

## 背景
- START_V45.cmd 只是旧版遗留的薄包装：内部仅执行
  `powershell -File start-surviv.ps1`；
- 真正的启动器是 start-surviv.ps1（含日志滚动、炸服自动重启）。

## 处理
1. 删除 `START_V45.cmd`（备份保留在 `.codex-backups/START_V45.cmd.bak`）；
2. `server/src/v41LauncherSmokeTest.ts`：
   - 移除对 START_V45.cmd 的读取断言；
   - 改为断言 start-surviv.ps1 包含 `Start-SurvivServerJob` 与 `AUTO-RESTART`
     （即当前启动器自身的核心能力）；
3. `docs/V45_INTERNAL_AIM_TARGET_BROKEN_ARROW_DODGE.md` 开发启动命令
   由 `START_V45.cmd` 改为 `start-surviv.ps1`。

## 验证
- test:v41-launcher：PASS ✅
- server tsc：PASS ✅
- 全项目已无对 START_V45.cmd 的文件引用（仅测试内注释提及历史）✅

## 使用方式
- 双击或命令行运行 `start-surviv.ps1`（PowerShell 脚本）即可启动。