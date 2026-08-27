# SmartBot InputMsg 越界修复

## 问题

Duel AI 在区域扫射、弹道反击、掩体攻击等路径中，曾把 `DecisionOutput.mouseLen` 设置为 120–255。

`InputMsg.toMouseLen` 的协议范围由 `net.Constants.MouseMaxDist` 定义，当前为 64：

```ts
s.writeFloat(this.toMouseLen, 0, Constants.MouseMaxDist, 8);
```

因此序列化时会触发：

```text
Error: writeFloat: value out of range: 255, range: [0, 64]
```

## 修复

1. 所有 `mouseLen` 战术赋值统一使用 `net.Constants.MouseMaxDist` 作为上限。
2. 在 `sendInputs()` 的数据包边界增加 `sanitizeMouseDistance()`：
   - 非有限值转为 0；
   - 小于 0 的值转为 0；
   - 大于 64 的值转为 64。
3. 新增 `server/src/smartBotInputSmokeTest.ts`，覆盖 255、120、Infinity、NaN、负数和正常值的真实 `InputMsg` 序列化。

## 验证

- 服务端 TypeScript 构建通过。
- 输入安全专项测试通过。
- Duel、Duel Lobby、Admin 原有测试通过。
- 真实进程中创建 Duel 房间并让两个 Bot 加入交战；运行超过原故障触发时间，没有出现 `writeFloat` 越界或 AI 退出。
