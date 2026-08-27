# V106 验证记录

## 改动文件

- client/src/game.ts

## 验证结果

| 检查项 | 结果 |
| --- | --- |
| client 构建（vite） | PASS |
| server 构建（tsc） | PASS |
| test:sandevistan | PASS |
| test:v41-suite（11 项） | PASS |

## 行为确认（强刷客户端后实测）

1. 激活斯安威斯坦后草地颜色正常，不再变黑。
2. 残影拖影、启动闪光、画面缩放、蓝调滤镜正常。
3. 结束后画面恢复；全程无 stage 滤镜挂载。