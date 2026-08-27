# V151 AI 装备率优化：空手优先可达资源 + 门口/错层卡住修复

## 现象（录像分析：17:14 50v50 实录）
- 空手 AI 装备率低；
- 旁边就有可拆资源时依然"无目的乱晃"；
- 录像证据：
  - bot 408：空手锁定 2.6 码外的物资，但物资在**另一层/屋顶**（indoors/roof:3697），
    水平距离够却永远够不到 → no-distance-progress → 放弃后乱晃；
  - bot 406：空手锁定建筑内箱子（crate 439/432，8~20 码），**门已开
    （door 428 open）**却在门口被墙反复挡、来回横跳 → 放弃 → 换另一个
    建筑内箱子继续卡，重复循环；
  - 每次放弃 backoff 9~24 秒，期间进入 weapon-search 乱晃，不再拆附近
    可达的箱子。

## 修复（server/src/smartBot.ts）
1. **steerToward 穿门补丁**：当已路由到**开着的门**且距离 ≤3.6 码时，
   目标点延伸到门洞对侧 1.7 码——确保穿过门洞而不是被门旁墙体 steering
   卡在门口反复横跳。
2. **chooseCrate 空手可达性倾向**：空手（无可用枪）时，开放区域的箱子
   评分 +45，室内箱子（bot 在室外需走门路由）评分 -70——优先拆"旁边
   就能拆"的箱子，室内箱子仅在没有开放选择时尝试。
3. **chooseUrgentEquipmentLoot 层/屋顶匹配过滤**：空手时，若目标物资
   与 bot 不在同一层/同一建筑（例如楼内物资 vs 楼顶 bot），距离 >2.2 码
   直接排除——避免锁定"看起来很近但够不到"的物资。

## 验证
- server tsc：PASS；
- test:loot-safety / test:resource-sweep / test:bot-brain /
  test:navigation-recovery / test:loot-ai / test:movement-jitter /
  test:v26-sim：全部 PASS；
- 开发环境 8001/3000 正常（ts-node 热重载）。

## 预期效果
- 空手 AI 优先选择视野内可达的开放区域箱子/枪，装备率提升；
- 门口与错层目标不再长时间卡住，减少"乱晃"；
- 新录像可复查：resource_target_abandoned 应显著减少，
  break-crate 意图能更快完成。