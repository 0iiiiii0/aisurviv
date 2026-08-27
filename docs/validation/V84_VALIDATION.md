# V84 阶段1 验证记录

## 改动文件

- shared/gameConfig.ts
- shared/defs/mapDefs.ts
- shared/defs/maps/sandevistanDefs.ts（新）
- shared/defs/gameObjects/sandevistanChipDefs.ts（新）
- shared/defs/gameObjectDefs.ts
- shared/net/updateMsg.ts
- server/src/config.ts
- server/src/game/game.ts
- server/src/game/objects/player.ts
- server/src/game/objects/playerBarn.ts
- server/src/game/weaponManager.ts
- server/src/bot/modeStrategy.ts
- server/src/adminSmokeTest.ts（模式数 47→50）
- server/src/allModesSmokeTest.ts（47→50 playlists / 17→18 maps）
- server/src/sandevistanSmokeTest.ts（新）
- server/package.json（test:sandevistan）

## 验证结果

| 检查项 | 结果 |
| --- | --- |
| server 构建（npm run build / tsc） | PASS |
| client 构建（tsc --noEmit && vite build） | PASS |
| test:sandevistan | PASS |
| test:v41-suite（11 项） | PASS |
| test:v53-matchmaking | PASS |
| test:worker-thread-room | PASS |

## 行为确认

1. 新模式"斯安威斯坦"（sandevistan 地图，solo/duo/squad，默认关闭）。
2. 激活后世界时间缩放到 35%（AI、子弹、毒圈、空投全部减速），施法者全速。
3. 施法者移速 +20%、散布 ×0.5；持续 5s、冷却 25s、击杀减 CD 4s。
4. 非 sandevistan 地图无法激活；冷却中无法激活。
5. 多激活者防御：世界缩放取最慢者。
6. 协议 85→86，activePlayerData 携带激活/冷却状态（阶段2 客户端 HUD 读取）。