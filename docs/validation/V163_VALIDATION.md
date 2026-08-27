# V163 验证记录：断线修复 + 仓库界面重做

## 断线修复验证

1. 定时器防御：热重载后不再抛
   `tickExtractionReplenish is not a function` ✓
2. uWS 竞态：5 次中途 abort 请求后 8001 存活、API 正常 ✓
3. 崩溃日志不再新增 uncaughtException ✓

## 仓库界面验证

1. cookie 身份：打开仓库自动读取玩家名并加载 ✓
2. 左栏：小人 + 4 装备槽 + 2 武器槽 + 携带弹药/药品/投掷物统计 ✓
3. 右栏：五类物资网格，图片 + 数量 ✓
4. 交互：装备/卸下、携带±1、移除、自动保存 ✓
5. 投掷物：可存入仓库、可带入配装（frag 存取测试通过）✓

## 回归

- server tsc、client build PASS
- test:extraction PASS
