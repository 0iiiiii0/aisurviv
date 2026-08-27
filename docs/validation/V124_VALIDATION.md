# V124 验证报告

## 变更范围

- `client/src/game.ts`：向 `SandevistanFx.update` 传入实时世界倍率。
- `client/src/objects/sandevistanFx.ts`：
  - `slowIntensity()`：`(1 - worldTimeScale) / 0.9` 钳制到 0..1；
  - 激活闪光半径/透明度、缩放 punch、后处理滤镜强度按系数缩放；
  - 默认 10% 减速时系数 = 1，行为与修改前完全一致。
- `client/public/admin/admin.js`：2077 卡片描述说明眩晕随减速变化。

## 自动化测试

- client tsc --noEmit：PASS
- vite build：PASS
- admin.js `node --check`：PASS

## 行为验证

- worldTimeScale=0.1 → 闪光半径 21px、滤镜强度 1.0（原版最强）；
- worldTimeScale=0.5 → 闪光半径约 12px、滤镜强度 0.76；
- worldTimeScale=1.0 → 仅保留最小闪光与 0.45 滤镜底色。

## 说明

- 眩晕强度与后台“对局速度”实时联动：修改后正在进行对局的
  下一次激活即按新倍率生效。
