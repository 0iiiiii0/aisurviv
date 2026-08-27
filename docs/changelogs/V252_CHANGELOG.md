# V252 修复观战时撤离点标记错误

## 问题
- 观战（外部观战者 / 死亡观战）时，小地图撤离点标记位置错误。

## 根因
- 客户端小地图撤离点用 `activePlayer`（观战时 = 被观战者）的
  `extractionPointIndex` 绘制；但服务端 `ExtractionPointMsg` 只同步给
  **玩家自己**，观战者收不到被观战者的固定撤离点索引 → 客户端该索引为
  -1，退化成"按当前位置计算最远点"，与玩家实际分配的固定撤离点不一致，
  观战标记错误。

## 修复
- `game/extractionSystem.ts`：撤离点同步遍历**所有玩家**（不只活玩家），
  对观战者（`spectating` 有目标）同步**被观战者**的固定撤离点索引与权威
  进度；普通玩家仍同步自己的。观战者客户端小地图随即显示被观战者的正确
  撤离点。

## 验证
- 新增 `server/src/extractionSpectatePointSmokeTest.ts`
  （`test:extraction-spectate-point`）：观战者收到的撤离点索引 =
  被观战者的固定索引；
- extraction / extraction-secret 冒烟测试 PASS；server `tsc` PASS。
