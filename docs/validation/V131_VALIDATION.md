# V131 验证记录：斯安威斯坦减速语义修正

## 修改范围
- server/src/config.ts、game/game.ts、game/objects/player.ts、adminServer.ts
- shared/gameConfig.ts（注释）
- client/public/admin/admin.js（后台卡片文案/默认值）
- server/src/sandevistanSmokeTest.ts、adminSmokeTest.ts

## 验证项与结果

### 1. server tsc：PASS

### 2. test:sandevistan：PASS
- 施法者移动按 50% 玩家时钟推进（断言在 35%~70% 带宽内，不再保持全速）；
- AI 按 10% 世界时钟推进（移动量小于施法者的 35%）；
- 技能持续/冷却计时仍按真实秒数走（realDt），不受自身减速影响；
- 非施法者（含人类冷却期、AI）统一按世界时钟走冷却；
- 其余断言（激活、击杀减 CD、模式隔离、地图交互减速等）全部保留并通过。

### 3. test:admin：PASS
- 初始默认值断言更新为 { playerTimeScale: 0.5, worldTimeScale: 0.1 }；
- 保存/校验流程通过。

### 4. client build（tsc + vite build）：PASS
- admin.js 静态资源随 dist 正常产出。

## 行为说明
- 对局中开启斯安威斯坦后：施法者本人射击/移动/打药/装弹按「玩家速度」%
  推进（默认 50%）；其他玩家、AI、子弹、毒圈、投掷物、地图交互按
  「对局速度」% 推进（默认 10%）；技能时长恒为真实秒数。
- 非斯安威斯坦模式：无施法者时两个倍率均为 1，行为与改动前完全一致。

## 生效方式
- 重启服务端（ts-node watch 自动加载）；后台刷新页面即可看到新文案。