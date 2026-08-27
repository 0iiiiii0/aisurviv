# V218 验证记录：SmartBot 消息对齐

## 验证

1. MatchTime / ExtractionPoint 分支消费消息体 ✓
2. 消息流保持对齐（不再把消息体当 type）✓
3. bot 心跳/解码不再失败重连 ✓
4. 构建与回归：server tsc、test:bot-brain、test:extraction PASS ✓

## 结论

- SmartBot 与新增协议消息兼容，搜打撤对局中 AI 稳定运行。
