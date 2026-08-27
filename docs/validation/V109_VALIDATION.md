# V109 验证报告

## 变更范围

- `client/src/objects/sandevistanFx.ts`：残影生成改为 EMA 窗口速度估计。
- `client/src/game.ts`：滤镜恢复挂载到 `pixi.stage`（全屏），并正确设置
  `filterArea` 与 `resolution`。

## 自动化测试

| 命令 | 结果 |
| --- | --- |
| client `tsc --noEmit` | PASS |
| server `tsc`（build） | PASS |
| `test:sandevistan` | PASS |
| `test:v41-suite`（11 项） | PASS |

## 浏览器实测（本机 localhost:3000，Normal 单人房间）

测试方法：加入真人+AI 房间，通过临时调试钩子强制 `sandevistanMode` 与
`sandevistanActive`，模拟持续移动输入，用 PIXI `extract.pixels` 采样。

### 残影生成（核心修复验证）

- 激活前（静止）：`inUse=0`，`ema=0`。
- 激活 + 持续移动：`inUse=2`（0.25s 节奏生成、0.42s 生命周期），
  `ema≈40-90`（EMA 稳定判定移动），`spawnAccumulator` 正常归零循环。
- 像素采样：未激活基线 `cyanCount=0`；激活+移动后 `cyanCount=1969`，
  `brightestCyan=[50,130,171]`（青蓝色拖影沿移动路径可见）。

### 全屏滤镜 + 草地颜色（V99/V106 回归验证）

- `stageFilter=true`、`uAmount≈1.0`、`filterArea=989x792`。
- 滤镜挂载时草地像素保持 `[128,155,131]` 等绿色，未出现黑屏/黑色草地。
- 关闭技能后滤镜正常卸载（`stageFilter=false`）。

## 结论

- 残影“没有出现”的根因（33Hz 位置更新导致生成累积器被清零）已修复并实测可见。
- 恢复“之前版本”的全屏后处理滤镜，草地不再变黑，效果明显增强。
