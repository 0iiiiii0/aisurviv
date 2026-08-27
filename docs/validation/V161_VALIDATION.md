# V161 验证记录：仓库配装与邀请组队修复

## 验证

1. 仓库面板：补齐样式后点击"仓库配装"弹出居中面板 ✓
2. stash API：3000 代理 / 8001 直连均返回仓库数据 ✓
3. 创建队伍：WebSocket 连接成功，返回 state，
   gameModeIdx=39、maxPlayers=2 ✓
4. 客户端按钮：双人按钮可用并选中；无 squad 启用时四人按钮隐藏 ✓
5. 构建与回归：server tsc、client build、
   test:extraction / test:admin PASS ✓

## 结论

- 仓库配装面板恢复正常显示与加载；
- 搜打撤（及所有模式）邀请组队不再因普通双人/四人关闭而被拒绝，
  且房间模式索引正确，可正常开始对局。
