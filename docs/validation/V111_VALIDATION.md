# V111 验证报告

## 变更范围

- `client/src/ui/ui2.ts`：技能槽在手机布局下变为可点击激活按钮。
- `client/src/game.ts`：消费手机端点击标志并发送 `Input.Sandevistan`。
- `client/css/game.css`：手机端按钮样式。

## 自动化测试

| 命令 | 结果 |
| --- | --- |
| client `tsc --noEmit` | PASS |
| client `vite build` | PASS |
| `test:sandevistan` | PASS |

## 浏览器实测（本机 localhost:3000，强制小屏布局）

| 检查点 | 结果 |
| --- | --- |
| 技能槽添加 `sandevistan-mobile` 类 | ✅ |
| 技能槽设置 `data-game-input-blocker` | ✅ |
| 技能槽在斯安威斯坦模式下可见 | ✅ |
| 点击技能槽 → `sandevistanButtonPressed=true` | ✅ |
| 下一帧 game.ts 消费并清零标志 | ✅ |

- 桌面端 `Input.Sandevistan`（默认鼠标中键/自定义键）路径不变，
  仍通过 `isBindPressed` 发送。
- 手机端点击路径与桌面端共用同一个 `Input.Sandevistan` 发送逻辑，
  服务端激活逻辑由 `test:sandevistan` 覆盖。

## 结论

- 手机端新增独立激活按钮：技能槽在手机布局下变成可点击的激活按钮，
  点击即激活斯安威斯坦；不会误触移动/瞄准摇杆。
