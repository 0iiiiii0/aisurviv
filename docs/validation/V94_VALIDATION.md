# V94 验证记录

## 改动文件

- client/src/objects/sandevistanPostFilter.ts（新）
- client/src/objects/sandevistanFx.ts
- client/src/game.ts

## 验证结果

| 检查项 | 结果 |
| --- | --- |
| client 构建（vite，639 模块） | PASS |
| server 构建（tsc） | PASS |
| test:sandevistan | PASS |
| test:v41-suite（11 项） | PASS |

## 行为确认（游戏内）

1. 激活时：画面边缘出现 RGB 色差、沿移动方向有空气折射波纹、
   移动方向产生方向性运动模糊；中心区域相对清晰。
2. 停止/收束时后处理平滑归零，无硬切。
3. 三个效果可分别通过配置开关关闭；qualityLevel=0 时整组禁用。
4. DOM HUD 不受后处理影响，保持清晰。