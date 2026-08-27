# V107 验证记录

## 改动文件

- shared/defs/extractionDefs.ts（新增）
- shared/defs/maps/extractionDefs.ts、shared/defs/mapDefs.ts
- shared/gameConfig.ts（DamageType.Extraction）
- server/src/game/extractionSystem.ts（新增）
- server/src/stash/stashManager.ts（新增）
- server/src/extractionLoadouts.ts（新增）
- server/src/game/game.ts、game/objects/player.ts
- server/src/apiServer.ts、adminServer.ts、config.ts
- server/src/extractionSmokeTest.ts（新增，test:extraction）
- server/src/allModesSmokeTest.ts、adminSmokeTest.ts（目录/配置断言修正）
- client/src/map.ts、game.ts、ui/ui2.ts、main.ts、extractionStashUi.ts（新增）
- client/index.html、css/game.css、public/admin/index.html、admin.js

## 验证结果

| 检查项 | 结果 |
| --- | --- |
| server 构建（tsc） | PASS |
| test:extraction | PASS |
| test:loot-fire-fix / bot-brain / cooperation / duel / sandevistan / all-modes / admin / room-lifecycle / bot-autofill-config / v53-matchmaking | PASS |
| client tsc | PASS |

## 使用步骤

1. 后台「模式管理」启用 **搜打撤**（默认关闭）。
2. （可选）后台「AI 自动补入」编辑搜打撤 AI 默认配装。
3. 菜单点 **仓库**：输入与进局相同的玩家名，添加物资并保存带入配装。
4. 进局后按 M/小地图查看 5 个撤离点；绿色光柱为当前开启（最远）撤离点；
   站入 5 秒撤离，物资自动入库。