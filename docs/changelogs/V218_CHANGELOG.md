# V218 修复 SmartBot 缺失 MatchTime / ExtractionPoint 消息分支

## 问题

服务端每秒广播 MatchTime（以及每 0.2s ExtractionPoint），浏览器客户端
会解析，但 SmartBot 的 onMsg switch 没有对应 case → 落入 `default:
return` **不消费消息体** → 消息体字节被当作下一条消息类型 →
解码失败 → 反复重连。

## 修复（server/src/smartBot.ts）

- 新增 `MsgType.MatchTime` 与 `MsgType.ExtractionPoint` 分支：
  反序列化消费消息体，保持消息流对齐；
- bot 不依赖这两个同步值，仅消费即可。

## 验证

- server tsc / test:bot-brain / test:extraction：PASS
