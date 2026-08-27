# V135 验证记录：真人信标节流 + AI 地毯式轰炸

## 测试
### npm run test:br-strobe（新增）
- planBrStrobeBarrage：
  - 0 信标 → null；2 信标无压力 → null（保留）；
  - 8 信标 → 主动地毯 3~5 个、留储备、非反击模式；
  - 1 信标 + 3 压力 → 反击 1 个、间隔 <400ms；
  - 距离 10 / 42、受伤 100ms、决斗模式 → null。
- 服务端节流（Game 实例 + 同步触发定时器）：
  - 人类第 1 个信标 → 锁定 + 3 条航线；
  - 人类第 2 个信标（锁定中）→ 0 条新增航线；
  - AI 信标 → 照常 3 条航线（豁免）；
  - 锁清零后人类信标恢复。
- 结果：PASS

## 回归
- server tsc：PASS
- test:airstrike-safety / test:forbidden-ai / test:forbidden-context /
  test:duel / test:bot-brain / test:bot-input / test:movement-jitter /
  test:v33-aim-brokenarrow：全部 PASS

## 环境
- 修复 package.json UTF-8 BOM（PowerShell 写入导致 ts-node 崩溃），
  开发服务器已干净重启（8001 + 3000 正常，api 200）。

## 结论
- 真人地毯式轰炸被限制为约每 2.8s 一次空袭引导；
- AI 拥有大量信标时会快速连扔 3~5 个进行地毯式轰炸，被轰炸时立即反击；
- 可进对局验证：AI 攒到 3 个以上信标后对真人连续引导空袭。