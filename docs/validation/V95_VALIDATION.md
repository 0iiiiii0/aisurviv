# V95 验证记录

## 改动文件

- client/src/input.ts
- client/src/inputBinds.ts
- client/src/objects/sandevistanFx.ts
- client/src/game.ts

## 验证结果

| 检查项 | 结果 |
| --- | --- |
| client 构建（vite） | PASS |
| server 构建（tsc） | PASS |
| test:sandevistan | PASS |
| test:v41-suite（11 项） | PASS |

## 行为确认

1. 未激活时 stage 无滤镜，地图渲染恢复正常（WebGL 与 Canvas 均无异常）。
2. 中键按下不会触发浏览器自动滚动；激活期间滤镜挂载、结束后卸载。
3. 旧浏览器存档（未含 Sandevistan 键位）加载后自动补默认中键；
   设置 → 按键绑定中可确认/修改。
4. Canvas 渲染器下后处理自动禁用（残影/闪光仍工作）。