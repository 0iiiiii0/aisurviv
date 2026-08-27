# V114 验证报告

## 变更范围

- `client/src/objects/sandevistanPostFilter.ts`：自定义顶点着色器（NDC 直映射）+
  重写片段着色器（全 vec4 整体采样，杜绝分通道采样）。
- `client/src/objects/sandevistanFx.ts`：移除 `setDirection` 调用。
- `client/src/game.ts`：滤镜纹理 `multisample = 0`。
- `client/src/main.ts`：临时调试钩子已全部移除。

## 自动化测试

| 命令 | 结果 |
| --- | --- |
| client `tsc --noEmit` | PASS |
| client `vite build` | PASS |
| `test:sandevistan` | PASS |

## 浏览器实测（真实屏幕 readPixels，1280x720 / DPR2）

| 场景 | black | green |
| --- | --- | --- |
| 关闭滤镜 | 0.7% | 97.4% |
| 开启滤镜（色差+扭曲+模糊+冷色调全开） | 0% | 100% |
| 修复前开启滤镜 | 79.3% | 9.6% |

- 开启滤镜后草地网格为 `[128,175,73]`（正常草地绿），与关闭时一致；
- 滤镜效果真实生效（草地细节被轻微平滑，与 OFF 网格有差异）。

## 结论

- 草地变黑问题已真正修复：根因是滤镜 shader 分通道采样在
  pixi.js-legacy 7.4.2 滤镜管线中黑屏，改为整体 vec4 采样后完全正常；
- 全屏后处理（色差式边缘偏移 / 扭曲 / 运动模糊 / 冷色调）保留。
