# V219 验证记录：AI 配装快照

## 验证

1. extraction 房间创建时携带 AI 配装快照 ✓
2. worker 使用房间快照（回退全局）✓
3. 非 extraction 房间不携带（节省消息体）✓
4. 构建与回归：server tsc、test:extraction / admin PASS ✓

## 结论

- 后台修改 AI 配装后，新创建/复用的房间即用最新配装。
