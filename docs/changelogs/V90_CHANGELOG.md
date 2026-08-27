# V90 第一批：斯安威斯坦特效系统（配置 + 状态机 + 残影 + 启动/停止特效）

> 依据完整特效规格实施的第一批（详见 V90_PLAN.md；后处理色差/扭曲/运动
> 模糊为第二批，音效为第三批）。

## 实现

### 1. 统一配置对象（shared/gameConfig.ts）
- 扩展 `GameConfig.player.sandevistan`，一次性加入规格全部字段：
  activationDuration / deactivationDuration / cameraFovBoost / cameraShakeStrength /
  afterimageEnabled / afterimageSpawnInterval / afterimageMinDistance /
  afterimageLifetime / afterimageMaxCount / afterimageOpacity / afterimageFadeCurve /
  afterimageColor（青蓝）/ afterimageEdgeColor（紫品红）/ afterimageDissolveStrength /
  chromaticAberrationEnabled+Strength / distortionEnabled+Strength /
  motionBlurEnabled+Strength / activationSound / loopSound / deactivationSound /
  soundPitchEffect / qualityLevel / multiplayerSafeMode。
  音效字段当前为空字符串（占位），数值全部集中、不再散落。

### 2. 客户端状态机（client/src/objects/sandevistanFx.ts，新）
- 状态：idle / activating / active / deactivating / cooldown / interrupted；
  由服务端 localData（sandevistanActive/Remaining/Cooldown）驱动边沿切换；
  死亡 / 倒地 / 观战 / 非本模式 / 对局结束 → interrupted 并立即清理特效。

### 3. 残影系统（2D Sprite 快照 + 对象池）
- 对象池：最多 `afterimageMaxCount` 个残影，超出回收最旧；
- 生成：active 期间按 `afterimageSpawnInterval` + `afterimageMinDistance`
  触发；深度克隆玩家 `bodyContainer`（保存生成时刻完整姿势/部件）；
- 更新：残影固定在世界屏幕坐标，alpha 按 lifetime + fadeCurve 淡出溶解；
  沿移动方向拉伸（stretch）；静止不堆积；
- 主色青蓝 tint、边缘紫品红配置就绪（边缘 pass 第二批做）；
- 残影容器位于角色层底部，不挡本体与 UI；不生成完整角色实体。

### 4. 启动 / 停止特效
- 启动：短促青绿脉冲闪光（0.18s，ADD 混合，不白屏）+ 画面轻微缩放
  （cameraFovBoost）+ 残影开始生成；
- 停止：deactivating 0.25s 内停止生成、残影快速淡出、闪光隐藏、
  缩放平滑恢复（overlayPunch 回弹）；
- interrupted 立即清理所有残影与闪光。

### 5. 集成（client/src/game.ts）
- init 创建 `SandevistanFx`，afterimageContainer 置于角色层底部、
  overlayContainer 置于世界与 HUD 之间；
- 每帧 update 驱动 fx；观战时 reset；free 时清理。

## 测试

- server / client 构建通过（client 新增 sandevistanFx 模块）；
- `test:sandevistan`、`test:v41-suite`（11 项）全部 PASS。

## 后续

- 第二批：PIXI Filter 实现 RGB 色差 / 空间扭曲 / 方向性运动模糊
  （配置字段已就绪，低 qualityLevel 自动降级）。
- 第三批：音效资源接入与音频低通/音调变化。