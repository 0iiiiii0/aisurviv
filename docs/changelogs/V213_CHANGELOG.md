# V213 修复协议错误仍创建玩家

## 问题

协议版本不符时发送断开消息后**没有 return**，后续代码继续执行：
创建玩家、消耗 join token、扣除搜打撤配装。

## 修复（server/src/game/objects/player.ts）

- 协议不符时：
  - **返还 join token**（avaliableUses +1）；
  - 发送断开消息后**直接 return**——不创建玩家、不扣配装。

## 验证

- 集成测试：错误协议 addPlayer 返回 undefined（未创建）✓
- join token 返还（avaliableUses >= 1，可再次使用）✓
- server tsc / test:extraction（新增断言）/ test:v42：PASS
