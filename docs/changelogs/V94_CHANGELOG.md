# V94 第二批：PIXI 后处理（色差 / 空间扭曲 / 方向性运动模糊）

## 需求

- 按特效规格完成第二批：高速状态期间加入轻度后处理——
  RGB 色差（中心清晰、边缘偏移）、空气折射/空间扭曲、方向性运动模糊；
  停止后平滑恢复；可配置关闭；低画质自动降级。

## 实现

### 新增 `client/src/objects/sandevistanPostFilter.ts`
- 自定义 `PIXI.Filter`，单 pass GLSL：
  - **色差**：R/B 通道沿径向偏移，强度随屏幕边缘增大（中心保持清晰）；
  - **空间扭曲**：沿移动方向垂直方向的正弦折射波纹（uTime 驱动，转向/加速时更明显）；
  - **方向性运动模糊**：沿移动方向 6 次采样加权混合，边缘增强、主体保持较清晰；
  - 三个效果由单一 `uAmount`（0–1）平滑驱动，个别开关（chromatic /
    distortion / motionBlur）通过 uniform 置零独立关闭；
  - `setAmount` 做平滑插值，`setDirection` 传玩家移动方向，`advance` 推进时间。

### 集成（client/src/game.ts + sandevistanFx.ts）
- 新建 filter 并应用到 `pixi.stage.filters`（DOM HUD 在 canvas 外不受影响）；
  `qualityLevel === 0` 时不启用（低画质降级）；
- `SandevistanFx.update` 每帧驱动：
  - activating / active → amount 趋向 1；deactivating → 0.35；其余 → 0；
  - 方向取玩家屏幕空间位移；toggles 取自 `GameConfig.player.sandevistan`；
- 对局结束（free）时清除 stage filters。

## 测试

- client 构建（vite，639 模块）通过；server 构建通过；
- `test:sandevistan`、`test:v41-suite`（11 项）全部 PASS。

## 说明

- 后处理作用于整个 PIXI 场景（世界 + 特效），DOM HUD 保持清晰；
- 停止/收束时 amount 平滑归零，无硬切；
- 若个别显卡对全屏 shader 有压力，把 `qualityLevel` 调 0 即关闭。