# V115 验证报告

## 变更范围

- `client/css/game.css`：新增 `[hidden] { display: none !important; }`。

## 自动化测试

| 命令 | 结果 |
| --- | --- |
| client `tsc --noEmit` | PASS |
| client `vite build` | PASS |
| `test:sandevistan` | PASS |

## 浏览器实测（localhost:3000）

| 模式 | hidden 属性 | computed display | 可见尺寸 |
| --- | --- | --- | --- |
| Normal（修复前） | true | block | 115×88（误显示） |
| Normal（修复后） | true | none | 0×0 |
| 2077（修复后） | false | block | 115×91 |

- 普通模式技能槽完全隐藏（display:none、无尺寸、不可交互）；
- 2077 模式技能槽正常显示，键位提示跟随用户自定义（[V]）。

## 结论

- 斯安威斯坦 HUD 现在只在 2077 模式显示；其余模式即使逻辑设置了
  hidden 也不再被 CSS 顶掉，彻底消除误显示。
