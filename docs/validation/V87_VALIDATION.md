# V87 验证记录

## 改动文件

- client/index.html
- client/src/objects/player.ts
- client/src/ui/ui2.ts
- client/css/game.css

## 验证结果

| 检查项 | 结果 |
| --- | --- |
| client 构建（tsc --noEmit && vite build） | PASS |
| server 构建（tsc） | PASS |
| test:v41-suite（11 项） | PASS |
| test:sandevistan | PASS |

## 行为确认

1. sandevistan 模式下底部出现技能槽：激活显示剩余秒 + 图标高亮 + 充能条满；
   冷却显示剩余秒 + 充能条回充；就绪显示"就绪"。
2. 激活期间全屏蓝色滤镜淡入，结束后淡出。
3. 非 sandevistan 模式技能槽隐藏、滤镜不生效。
4. 音效与物品图暂为占位，未接入。