# V99 验证记录

## 改动文件

- client/src/objects/sandevistanFx.ts
- client/src/objects/sandevistanPostFilter.ts
- client/src/game.ts

## 验证结果

| 检查项 | 结果 |
| --- | --- |
| client 构建（vite） | PASS |
| server 构建（tsc） | PASS |
| test:sandevistan | PASS |
| test:v41-suite（11 项） | PASS |

## 行为确认（需强刷客户端后实测）

1. 激活斯安威斯坦后草地不再变黑（滤镜区域=全屏，采样不越界）。
2. 色差/扭曲/运动模糊在滤镜区域内正常显示。
3. 结束后滤镜卸载，画面恢复。