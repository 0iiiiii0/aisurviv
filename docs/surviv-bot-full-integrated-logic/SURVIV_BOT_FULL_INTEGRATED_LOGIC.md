# Surviv.io Smart Bot — 完整整合逻辑包 (Full Integrated Spec)

version: integrated-full-2026-07-24
audience: 其他 AI / 实现者一次性实现全部决策

---

## 0. 全局硬约束

1. `toMouseLen` 发送前必须 `clamp(0, 64)`，否则崩溃
2. `BOT_TEAM_SIZE` 匹配模式: solo=1 duo=2 squad/50v50小队=4
3. 仅客户端可见信息；同 teamId 友军禁止伤害
4. **致死毒圈是硬分支**，禁止与拆箱/搜索同一 score 池比较
5. 禁止隔墙拆箱（可达 + 无实心遮挡）

---

## 1. 每 Tick 总仲裁（严格顺序）

```
1. 协议: mouseLen clamp
2. 致死毒圈 / 站在圈外会等死 → 立刻跑向安全区内侧（可切近战加速）
   - 中断拆箱/闲逛/站桩对射/红区长读药
3. 敌人已近战攻击我 → 停拆，反击
4. 拆箱中遇敌 → 表 B（见 §5）
5. 真人弹药请求 / AI 黑板 ammo_need → 分享逻辑（§11），非危机时可打断 explore
6. 信号枪完整逻辑（§10）拾取/发射/丢弃
7. 残血且严格安全（掩体或室内）→ 打药
8. if unarmed → 找枪链（§4）
9. else if 1v1 → 决斗战术 only
10. else if 50v50 → doctrine / 集火 / 救援
11. else → 搜/打/转点正常逻辑
12. 拆箱前永远: 同层 + 寻路到站位 + 无隔墙 + 能拆
```

---

## 2. 自然感

- 反应延迟 80–320ms；瞄准 jitter；目标粘性 0.6–1.5s
- 换弹/吃药/开门停火；避免永久左右平移
- 同等分数轻微随机

---

## 3. 搜 / 打 / 奶

**成型**: 有枪+弹即可应战；甲/药影响主动进攻意愿。

| 该搜 | 该打 | 该奶 |
|------|------|------|
| 无枪/弹尽/早期 | 有利人数距离掩体 | 掩体或室内 + 短时未掉血 |
| 远枪声未成型不赴约 | 贴脸必须应战 | 禁止开阔站桩长读 |
| | 无枪不硬冲有枪 | 跑毒优先于红区 medkit |

---

## 4. 无枪（Unarmed）

```
地面枪×3 > 可达掉落箱×2.25 > 金库面板×2 > 高价值POI > 闲逛
主动进攻×0.15
```

拆箱见地上枪 → 立刻停拆去捡。D 级及以上枪都可捡。

---

## 5. 拆箱链 A + 遇敌表 B

**A**: 拆完同一帧选下一只合法箱，禁止空窗 explore。

**B**:
| 条件 | 动作 |
|------|------|
| 敌人已近战打我 | 停拆反击 |
| 我有枪 | 停拆先反击 |
| 我没枪敌人有枪 | 弃箱逃跑 |
| 双方没枪且未被近战 | 继续拆 |

---

## 6. 可破坏物 / EV / 近战

- 掉落容器: crate/chest/cache/airdrop… 
- 纯掩体: wall/tree/rock/sandbag → 不当搜刮
- 爆炸桶: 可炸人，不当搜刮目标
- `hits = ceil(hp / melee.obstacleDamage)`；>16 或不破坏 → 不硬磕
- 铁门/硬石默认不近战当箱砍

---

## 7. 禁止隔墙打箱子

必须: 同层 + 路径到近战点 + 点到箱无实心墙/关门 + canDestroy  
关门: 先开门再拆。丢 LoS 立即停。

---

## 8. 门

- 普通: canUse 未锁未开 → F 开，开了不按
- 已开: 当路
- 锁: 找钥匙/面板/绕路，不空按
- 自动门: 等 open
- 字段: isDoor, open, canUse, locked, layer

---

## 9. 控制面板 / 金库

- `Use Control Panel` → F → 等铁门开 → 警戒再搜
- 优先面板，不近战硬砍厚铁门
- 不安全/毒紧不开；金库无枪限时限深；50v50 防团灭塞库

---

## 10. 毒圈 + 信号枪

### 毒圈
- outside 且 survive_time <= travel + buffer → 强制跑毒
- 目标安全区内侧；禁止站毒等死

### 信号枪 (F 档工具)
- 枪+弹都有（看到或包里）→ 立刻捡齐
- 非交战区发射空投
- 弹尽 → 立刻丢弃信号枪
- 只有枪无弹 → 忽略/丢弃，不当货

---

## 11. 弹药分享

### 真人 C+右键要弹
- 同队附近 AI 响应
- **不需要该弹种的优先，可全倒完**
- 需要者保留 ~1 匣
- **50v50 可多人同时给**
- 丢完后 **礼物标记** 落点

### 人机 ↔ 人机
- 弹少黑板 `ammo_need`
- 有不需要的就分享
- **后端黑板坐标，不打礼物标**

稀有弹: 自己不需要 → 优先全给有对应枪的队友。

---

## 12. 武器分级

S+ > S > A > B > C > D > F  
score: 100/85/70/55/40/25/5

S+: Rainbow Blaster, AWM-S, USAS-12, Super 90, M134, Potato Cannon, M79  
S: SV-98, Mosin-Nagant, M4A1-S, Mk 20 SSR, M249, Saiga-12, SPAS-12, Lasr Gun, Heart Cannon, Flamethrower, Spud Gun  
A: M1 Garand, L86A2, SVD-63, Mk45G, SCAR-H, Groza-S, Groza, AN-94, QBB-97, PKP, PKM, BAR M1918, Vector(.45), Vector(9mm), CZ-3A1, MP220, Hawk 12G, P30L, DEagle 50  
B: AK-47, M416, FAMAS, DP-28, M39 EMR, Mk 12 SPR, VSS, Scout Elite, BLR-81, M870, M1100, MAC-10, M1A1, UMP9, MP5, Peacemaker, OTs-38  
C: G18C, M93R, OT-38, M1911, Model 94  
D: M9, M9 Cursed, Water Gun  
F: Flare Gun, Bugle  

更高档优先换；F 不当主 DPS；情境微调不超过 1 档。

---

## 13. 分模式

| 模式 | team | 要点 |
|------|------|------|
| Solo | 1 | 第三者、搜刮链、faction off |
| Duo | 2 | 集火、救援、箱预约 |
| Squad | 4 | 角色分工强集火 |
| 50v50 | 4+faction | doctrine 战线桥头侧翼医药；多人给弹；空投谨慎 |
| 1v1 | 1 | 不 BR 搜刮；沙袋战术；激素满/禁 |

50v50 doctrine: push|hold|flank|reserve|retreat_regroup  
桥不站心；分层推；集火粘性；有组织撤。

---

## 14. 最终 Tick 伪代码

```
onTick:
  update world
  if gas_lethal: run_gas; return
  if enemy_meleeing_me: combat; return
  if breaking and threat: table_B; return
  if human_ammo_req or bot_ammo_need: try_share; // 可部分并行
  if flare_pick_or_fire_or_drop: handle_flare
  if need_heal and safe_cover: heal; return
  if unarmed: gun_hunt_chain; return
  if mode_1v1: duel; return
  if mode_50v50: faction_doctrine; return
  if should_engage: combat; return
  if rescue: rescue; return
  rotate_or_loot
  send inputs (mouseLen clamped)
```

---

## 15. 环境与安装

env: BOT_SERVER, BOT_REGION, BOT_COUNT, BOT_TEAM_SIZE, BOT_GAME_MODE,
BOT_DIFFICULTY, BOT_TICK_MS, BOT_MAP_AI, BOT_FACTION_AI, BOT_COMBAT_INTELLIGENCE,
BOT_CONCEALMENT_TACTICS, BOT_1V1_MODE, BOT_NO_ADRENALINE

v13 源码覆盖进主项目 server/src 后: `npm run bot`（Windows 用 npm.cmd）

---

END
