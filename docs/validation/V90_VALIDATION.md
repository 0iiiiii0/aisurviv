# V90 第一批验证记录

## 改动文件

- shared/gameConfig.ts（sandevistan 特效配置扩展）
- client/src/objects/sandevistanFx.ts（新：状态机 + 残影 + 特效）
- client/src/game.ts（fx 创建/容器/每帧驱动/清理）

## 验证结果

| 检查项 | 结果 |
| --- | --- |
| server 构建（tsc） | PASS |
| client 构建（vite，638 模块） | PASS |
| test:sandevistan | PASS |
| test:v41-suite（11 项） | PASS |

## 行为确认（游戏内）

1. 按 G 激活：出现青绿脉冲闪光 + 画面轻微缩放，随后高速移动时生成
   青蓝色残影轨迹（随时间淡出溶解、沿移动方向拉伸）。
2. 静止不堆积残影；高速残影多、低速少。
3. 能力结束：残影快速淡出，画面平滑恢复，无硬切。
4. 死亡/观战/切图：特效立即清理。
5. 状态机六态驱动全部特效，无散落布尔。

## 未完成（下一批）

- PIXI 后处理：RGB 色差 / 空间扭曲 / 方向性运动模糊（配置已就绪）。
- 音效资源（占位空串）与音频低通/音调。