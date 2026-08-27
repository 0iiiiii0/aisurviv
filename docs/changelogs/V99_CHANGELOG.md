# V99 修复：激活后草地变黑（PIXI 后处理滤镜）

## 问题

- 开启斯安威斯坦（激活后）草地变成黑色。

## 根因

- V94 的全屏后处理滤镜挂到 `pixi.stage.filters` 时，**没有为 stage 设置
  `filterArea`**（PIXI v7 对 stage 应用滤镜需要显式滤镜区域），导致滤镜
  离屏渲染区域异常、地面层采样到错误/越界区域而变黑。
- 滤镜 shader 中色差/扭曲/运动模糊的采样坐标可能越出纹理边界
  （`texture2D` 越界采样返回黑色）。

## 修复（client/src/objects/sandevistanFx.ts + sandevistanPostFilter.ts + game.ts）

1. 挂载 stage 滤镜时同步设置 `filterArea = renderer.screen`，
   卸载时仅清 `filters`（无滤镜时 filterArea 被忽略）；
   `SandevistanFx` 构造接收屏幕矩形（game.ts 传入 `pixi.screen`）。
2. 滤镜 shader 的所有采样点（色差 / 扭曲 / 运动模糊）改为
   `clamp(uv, 0.0, 1.0)`，杜绝越界采样导致的黑色。

## 测试

- client / server 构建通过；
- `test:sandevistan`、`test:v41-suite`（11 项）全部 PASS。