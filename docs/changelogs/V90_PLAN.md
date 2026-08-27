# V90 规划：斯安威斯坦特效系统（客户端）实现方案

> 依据你提供的完整特效规格（启动/高速/时间减速/色差/运动模糊/收束/
> 2D Sprite 快照/状态机/参数配置）落地到本项目（PIXI v7 客户端）。

## 架构结论

- 客户端使用 **PIXI v7**（pixi.js-legacy），角色由多部件 Sprite 组成
  （bodyContainer：身体/胸甲/头盔/手/枪等），主循环为
  `pixi.ticker`（game.update 每帧调用）。
- 服务器已实现权威"世界时间减速"（worldDt 0.35，AI/子弹/毒圈减速、
  施法者全速），满足规格第 3 条；客户端补视觉表现。

## 分三批实施

### 第一批（本次）：统一配置 + 状态机 + 残影系统 + 启动/停止特效
1. **统一配置对象**：扩展 `GameConfig.player.sandevistan`，包含规格全部字段
   （激活/结束时长、残影参数、色差/扭曲/模糊开关与强度、音效占位空串、
   qualityLevel、multiplayerSafeMode），数值不散落。
2. **客户端状态机**：新模块 `SandevistanFx`，状态
   `idle / activating / active / deactivating / cooldown / interrupted`，
   由服务端 localData（sandevistanActive/Remaining/Cooldown）驱动；
   死亡/观战/切图/断线 → interrupted 并立即清理特效。
3. **残影系统（2D Sprite 快照 + 对象池）**：
   - 对象池：预分配 `afterimageMaxCount` 个残影容器；
   - 生成：active 期间按 `afterimageSpawnInterval` / `afterimageMinDistance`
     触发，深度克隆玩家 `bodyContainer`（保存生成时刻完整姿势/部件）；
   - 更新：残影固定在世界坐标，alpha 按 `afterimageLifetime` +
     `afterimageFadeCurve` 淡出溶解；沿移动方向轻微拉伸；
     高速多、低速少、静止不堆积；旧残影自动回收；
   - 颜色：青蓝为主（afterimageColor），边缘紫/品红
     （afterimageEdgeColor，轻量描边）；
   - 不生成完整角色实体、不挡 UI（容器置于角色层底部）。
4. **启动/停止特效**：
   - 启动闪光：短促青绿脉冲（0.1–0.25s，不白屏/不遮挡）；
   - 画面轻微缩放震动（cameraFovBoost / cameraShakeStrength）；
   - RGB 色差边缘：CSS 双色 overlay 轻量版（全屏 shader 第二批）；
   - 收束：结束 0.25s 内残影快速淡出、闪光淡出、滤镜平滑恢复。

### 第二批：后处理（色差 / 空间扭曲 / 方向性运动模糊）
- 用 PIXI Filter（@pixi/filter-* 或自定义 shader）做
  RGB 色差（中心清晰、边缘偏移）、空气折射扭曲、方向性运动模糊；
- 移动主体保持清晰、模糊沿移动方向与背景边缘；停止快速恢复；
- 全部可配置关闭（chromaticAberrationEnabled / distortionEnabled /
  motionBlurEnabled），残影系统独立工作；
- qualityLevel 低档自动关闭/降级后处理。

### 第三批：音效与状态细化
- activationSound / loopSound / deactivationSound（当前占位空串）；
- 环境声音低通/恢复、声音音调变化（audioManager 接入）；
- Interrupted 路径完善（死亡/复活/切换角色/断线/观战/重载）。

## 关键文件

- shared/gameConfig.ts（配置扩展）
- client/src/objects/sandevistanFx.ts（新：状态机 + 残影 + 特效）
- client/src/game.ts（init 创建 fx + 容器入 stage；update 驱动）
- client/src/objects/player.ts（残影克隆数据源 bodyContainer）
- client/src/ui/ui2.ts（HUD 联动，保留现有技能槽/滤镜）
- client/index.html / css（启动闪光 overlay 等）

## 验证

- server/client 构建；test:sandevistan + v41-suite 回归；
- 游戏内 G 键激活查看残影轨迹、启动/收束特效、HUD 状态机表现。