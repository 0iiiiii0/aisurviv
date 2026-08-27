import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { ObjectType } from "../../shared/net/objectSerializeFns.ts";
import { RawGameObjectDefs as GameObjectDefs } from "../../shared/defs/gameObjectDefs.ts";
import { Config } from "./config.ts";
import { stashManager } from "./stash/stashManager.ts";
import { Game } from "./game/game.ts";
import type { Player } from "./game/objects/player.ts";

const previousBoss = JSON.parse(JSON.stringify(Config.extractionBoss)) as
    typeof Config.extractionBoss;
const previousSecret = { ...Config.extractionSecret };

function bossPlayers(game: Game): Player[] {
    return game.playerBarn.players.filter(
        (p) => (p as unknown as { isBoss?: boolean }).isBoss === true,
    );
}

function joinHuman(game: Game, name: string): Player {
    return game.playerBarn.addTestPlayer({ name });
}

void (async () => {
    try {
        // 配置 Boss：3 个默认天赋 + 天赋池随机一个 + 武器 + 掉落表。
        Config.extractionSecret.enabled = true;
        Config.extractionBoss.enabled = true;
        Config.extractionBoss.maxHealth = 800;
        Config.extractionBoss.count = 2;
        Config.extractionBoss.bossDefaultPerks = ["steelskin", "flak_jacket", "gotw"];
        Config.extractionBoss.bossPerks = ["firepower", "gotw"];
        Config.extractionBoss.bossPositions = {};
        // 部署配置可能自带 armor.helmet（如 helmet03）→ 必须清空，
        // 否则覆盖默认队长盔 helmet04_leader，断言随环境漂移。
        Config.extractionBoss.armor = {};
        Config.extractionBoss.weapons = [{ type: "m249", count: 1 }];
        Config.extractionBoss.dropItems = [
            { type: "awc", count: 1, weight: 100 },
            { type: "frag", count: 2, weight: 100 },
            // 模拟后台把 Boss 已装备的武器也配进掉落表 → 必须去重，只掉 1 把
            { type: "m249", count: 1, weight: 100 },
        ];

        const game = new Game(
            `extraction-boss-${Math.random().toString(36).slice(2)}`,
            { mapName: "extraction_secret", teamMode: TeamMode.Solo },
        );
        const bosses = bossPlayers(game);
        const plannedBossPositions = game.resolveBossPositions();
        assert.equal(
            plannedBossPositions.length,
            Config.extractionBoss.count,
            "landmark/fallback planning must honor the configured boss count",
        );
        Config.extractionBoss.count = 3;
        assert.equal(
            game.resolveBossPositions().length,
            3,
            "deterministic fallback points must fill counts beyond the two landmark slots",
        );
        Config.extractionBoss.count = 2;
        assert.equal(
            bosses.length,
            Config.extractionBoss.count,
            "secret extraction must spawn exactly the configured boss count",
        );
        for (let bossIndex = 0; bossIndex < bosses.length; bossIndex++) {
            const boss = bosses[bossIndex];
            const planned = plannedBossPositions[bossIndex];
            assert.equal(boss.layer, planned.layer ?? 0, "boss uses the planned gameplay layer");
            assert.ok(
                Math.hypot(boss.pos.x - planned.x, boss.pos.y - planned.y) <= 100,
                "boss remains near its landmark/fallback resource point",
            );
            assert.ok(
                game.map.isPlayerWalkableAt(boss.pos, boss.layer, boss.rad + 0.05),
                "boss spawn point has player-sized collision clearance",
            );
            let openExits = 0;
            for (let direction = 0; direction < 8; direction++) {
                const angle = direction * Math.PI / 4;
                const endpoint = {
                    x: boss.pos.x + Math.cos(angle) * 3,
                    y: boss.pos.y + Math.sin(angle) * 3,
                };
                if (
                    game.map.hasPlayerWalkPath(
                        boss.pos,
                        endpoint,
                        boss.layer,
                        boss.rad + 0.05,
                    )
                ) {
                    openExits++;
                }
            }
            assert.ok(openExits >= 3, "boss spawn point must not be a wall seam or movement trap");
            assert.equal(
                (boss as unknown as { isBoss: boolean }).isBoss,
                true,
            );
            assert.equal(
                boss.helmet,
                "helmet04_leader",
                "boss must use the 50v50 captain helmet",
            );
            assert.ok(
                /^outfit(Red|Blue)Leader$/.test(boss.outfit),
                "boss must use the faction leader outfit",
            );
            assert.equal(
                (boss as unknown as { bossHealthBuffer: number }).bossHealthBuffer,
                800,
                "boss extra HP buffer from config",
            );
            for (const perk of ["steelskin", "flak_jacket", "gotw"]) {
                assert.ok(boss.hasPerk(perk), `boss must wear default perk ${perk}`);
            }
            assert.ok(
                ["firepower", "gotw"].includes(boss.bossWornPerk),
                "boss randomly wears one pool perk",
            );
            assert.ok(
                String(boss.weapons[GameConfig.WeaponSlot.Primary]?.type ?? "") ===
                    "m249",
                "boss equips its configured weapon",
            );
            assert.equal(
                boss.weapons[GameConfig.WeaponSlot.Primary]?.ammo,
                (GameObjectDefs["m249"] as unknown as { maxClip: number }).maxClip,
                "boss must spawn with a full clip (not 1 bullet)",
            );
        }

        // Boss AI：巡逻 + 追击 + 攻击。将 Boss 放到巡逻中心旁。
        const boss = bosses[0];
        boss.pos.x = 300;
        boss.pos.y = 300;
        boss.layer = 0;
        boss.aimLayer = 0;
        boss.bossPatrolCenter = { x: 300, y: 300 };
        // 清障：测试区域（295-335 方块）内真实障碍标记 dead，保证视线干净
        //（LOS 修复后真实建筑/障碍会正确遮挡视线，测试靶场必须先清障）。
        for (const obj of game.objectRegister.objects) {
            const o = obj as unknown as {
                __type?: number;
                dead?: boolean;
                collidable?: boolean;
                pos?: { x: number; y: number };
                bounds?: { min?: { x: number; y: number }; max?: { x: number; y: number } };
            };
            const isSolid =
                o.collidable === true ||
                o.__type === ObjectType.Building ||
                o.__type === ObjectType.Structure;
            if (!isSolid) continue;
            if (o.bounds?.min && o.bounds?.max) {
                // bounds 是局部坐标，转世界坐标后判定是否落在测试区域
                const wMin = {
                    x: o.bounds.min.x + (o.pos?.x ?? 0),
                    y: o.bounds.min.y + (o.pos?.y ?? 0),
                };
                const wMax = {
                    x: o.bounds.max.x + (o.pos?.x ?? 0),
                    y: o.bounds.max.y + (o.pos?.y ?? 0),
                };
                if (wMin.x < 335 && wMax.x > 295 && wMin.y < 335 && wMax.y > 295) {
                    o.dead = true;
                }
            }
        }
        // 服务端绝密资格校验：人类 Target 需配装合格武器（A/S/S+）。
        stashManager.addItem("Target", "m4a1", 1);
        stashManager.setLoadout("Target", {
            guns: ["m4a1", ""],
            ammo: {},
            consumables: {},
            armor: {},
        });
        const human = joinHuman(game, "Target");
        human.pos.x = 325;
        human.pos.y = 300;
        const updateBossAI = () =>
            (
                game as unknown as {
                    updateBossAI(dt: number): void;
                }
            ).updateBossAI(1 / 30);
        updateBossAI();
        assert.equal(boss.shootStart, true, "boss must open fire at a nearby human");
        assert.ok(
            Math.abs(boss.dir.x - 1) < 0.01,
            "boss must aim toward the human",
        );

        // 隔墙不射击：Boss(300,300) 与 human(325,300) 之间加一面墙 → 停火。
        const wall = {
            __type: ObjectType.Structure,
            dead: false,
            collidable: undefined,
            layer: 0,
            pos: { x: 312, y: 300 },
            // bounds 为局部坐标（真实对象语义）：世界 AABB = bounds + pos
            // = (310,295)-(315,305)，正好挡在 Boss(300,300)→human(325,300) 之间。
            bounds: { min: { x: -2, y: -5 }, max: { x: 3, y: 5 } },
        };
        game.objectRegister.objects.push(wall as never);
        updateBossAI();
        assert.equal(
            boss.shootStart,
            false,
            "boss must NOT shoot through a wall",
        );

        // 场景：A(human) 退回掩体后（BOSS 仍锁着 A），B(human2) 立刻出现在
        // 开阔地（可见）→ Boss 必须立即切换打 B，不等 2 秒 LOS 计时。
        stashManager.addItem("Target2", "m4a1", 1);
        stashManager.setLoadout("Target2", {
            guns: ["m4a1", ""],
            ammo: {},
            consumables: {},
            armor: {},
        });
        const human2 = joinHuman(game, "Target2");
        human2.pos.x = 320;
        human2.pos.y = 320;
        updateBossAI();
        assert.equal(
            (boss as unknown as { bossTarget: unknown }).bossTarget,
            human2,
            "boss must immediately switch from cover-hidden target to visible target",
        );
        // B 逃逸 → 立即放弃 B；随后 Boss 重新锁定仍在附近的 A（掩体后）。
        human2.pos.x = 400;
        human2.pos.y = 400;
        updateBossAI();
        assert.equal(
            (boss as unknown as { bossTarget: unknown }).bossTarget,
            human,
            "boss must drop the escaped target and re-acquire the cover target",
        );

        // 无可见目标时：持续隔墙 → 放弃被掩体挡死的 A，不再死追。
        // 模拟"已持续无视线 4.5 秒"（同步循环中 Date.now() 不推进，
        // 不能依赖真实时间），下一次 updateBossAI 应立即放弃。
        (
            boss as unknown as { bossNoLosSince: number }
        ).bossNoLosSince = Date.now() - 4500;
        for (let i = 0; i < 5; i++) updateBossAI();
        assert.equal(
            (boss as unknown as { bossTarget: unknown }).bossTarget,
            null,
            "boss must abandon a target fully blocked by cover",
        );
        // 拆墙后冷却结束（同步循环中时间不推进，直接清冷却）→ 重新锁定。
        const wallIdx = game.objectRegister.objects.indexOf(wall as never);
        game.objectRegister.objects.splice(wallIdx, 1);
        (boss as unknown as { bossTargetNoLosUntil: number }).bossTargetNoLosUntil = 0;
        for (let i = 0; i < 5; i++) updateBossAI();
        assert.equal(
            (boss as unknown as { bossTarget: unknown }).bossTarget,
            human,
            "boss must re-acquire the target after the wall is gone",
        );
        assert.equal(
            boss.shootStart,
            true,
            "boss must resume fire after the wall is gone",
        );

        // 索敌切换：目标逃出追击范围 → 立即放弃；附近新目标 → 立即锁定。
        human.pos.x = 400;
        human.pos.y = 300;
        updateBossAI();
        assert.equal(
            (boss as unknown as { bossTarget: unknown }).bossTarget,
            null,
            "boss must drop a target that escaped the chase range",
        );
        human2.pos.x = 315;
        human2.pos.y = 300;
        updateBossAI();
        assert.equal(
            (boss as unknown as { bossTarget: unknown }).bossTarget,
            human2,
            "boss must immediately re-acquire the nearest target",
        );

        // Historical regression: a boss standing on its patrol edge was hit by a
        // close attacker just outside the acquisition zone. Damage selected the
        // attacker, but the next AI tick dropped it and kept the stationary latch,
        // so the boss died without returning fire.
        boss.pos.x = 318;
        boss.pos.y = 300;
        boss.bossPatrolCenter = { x: 300, y: 300 };
        boss.bossPatrolRadius = 18;
        human2.pos.x = 326;
        human2.pos.y = 300;
        (boss as unknown as { bossTarget: Player | null }).bossTarget = null;
        (boss as unknown as { bossStationaryUntil: number }).bossStationaryUntil =
            Date.now() + 5000;
        (boss as unknown as { bossUnstuckUntil: number }).bossUnstuckUntil =
            Date.now() + 1500;
        (boss as unknown as { bossStuckCount: number }).bossStuckCount = 3;
        (boss as unknown as { bossStuckSince: number }).bossStuckSince =
            Date.now() - 1001;
        (boss as unknown as { bossLastStuckPos: { x: number; y: number } }).bossLastStuckPos =
            { x: boss.pos.x, y: boss.pos.y };
        boss.damage({
            amount: 1,
            damageType: GameConfig.DamageType.Player,
            dir: { x: 1, y: 0 },
            source: human2,
            gameSourceType: "m4a1",
        });
        assert.equal(
            (boss as unknown as { bossTarget: unknown }).bossTarget,
            human2,
            "damage must immediately target the attacker",
        );
        assert.equal(
            (boss as unknown as { bossStationaryUntil: number }).bossStationaryUntil,
            0,
            "damage retaliation must cancel the stationary latch",
        );
        assert.equal(
            (boss as unknown as { bossUnstuckUntil: number }).bossUnstuckUntil,
            0,
            "damage retaliation must cancel stale escape movement",
        );
        assert.equal(
            (boss as unknown as { bossStuckCount: number }).bossStuckCount,
            0,
            "damage retaliation must clear stale stuck counters",
        );
        updateBossAI();
        assert.equal(
            (boss as unknown as { bossTarget: unknown }).bossTarget,
            human2,
            "hit-chase must retain an attacker outside the patrol acquisition zone",
        );
        assert.equal(
            boss.shootStart,
            true,
            "boss must return fire while backing away from a close attacker",
        );
        assert.ok(
            boss.dir.x > 0.99 && Math.abs(boss.dir.y) < 0.01,
            "boss returning toward patrol center must keep its weapon aimed at the attacker",
        );

        // Both humans contribute, but Target2 deals more total effective damage.
        boss.damage({
            amount: 1,
            damageType: GameConfig.DamageType.Player,
            dir: { x: 1, y: 0 },
            source: human,
            gameSourceType: "m4a1",
        });
        boss.damage({
            amount: 3,
            damageType: GameConfig.DamageType.Player,
            dir: { x: 1, y: 0 },
            source: human2,
            gameSourceType: "m4a1",
        });
        assert.ok(
            (boss.bossDamageContributions.get(human2.__id) ?? 0) >
                (boss.bossDamageContributions.get(human.__id) ?? 0),
            "Target2 must be the highest boss damage contributor",
        );

        // 击杀 Boss：掉落配置武器 + 掉落表 + 随机佩戴天赋。
        const lootBefore = game.lootBarn.loots.length;
        boss.kill({
            amount: 9999,
            damageType: GameConfig.DamageType.Player,
            dir: { x: 1, y: 0 },
            source: undefined,
        });
        const dropped = game.lootBarn.loots
            .slice(lootBefore)
            .map((loot) => loot.type);
        assert.ok(dropped.includes("m249"), "boss must drop its configured weapon");
        assert.equal(
            dropped.filter((t) => t === "m249").length,
            1,
            "boss weapon must NOT drop twice even when listed in drop table",
        );
        assert.ok(
            !dropped.includes("helmet04_leader"),
            "boss equipped armor must not be duplicated from drop table",
        );
        assert.ok(dropped.includes("awc"), "boss must drop configured loot");
        assert.ok(dropped.includes("frag"), "boss must drop configured throwable");
        assert.ok(
            dropped.includes(boss.bossWornPerk),
            "boss must drop its worn random perk",
        );
        const protectedDrops = game.lootBarn.loots.slice(lootBefore);
        assert.ok(protectedDrops.length > 0, "boss must create protected drops");
        assert.ok(
            protectedDrops.every((loot) => loot.ownerId === human2.__id),
            "every boss death drop, including weapon ammo, belongs to the highest damage human",
        );
        assert.ok(
            protectedDrops.every((loot) => loot.ownerExpiresAt > Date.now()),
            "boss loot protection must have a future expiry",
        );
        const protectedLoot = protectedDrops[0];
        human.pos.x = protectedLoot.pos.x;
        human.pos.y = protectedLoot.pos.y;
        human.layer = protectedLoot.layer;
        assert.notEqual(
            human.getClosestLoot(),
            protectedLoot,
            "a non-owner cannot select protected boss loot",
        );
        protectedLoot.ownerExpiresAt = Date.now() - 1;
        protectedLoot.update(0);
        assert.equal(
            protectedLoot.ownerId,
            0,
            "expired boss loot protection is released authoritatively",
        );
        assert.equal(
            human.getClosestLoot(),
            protectedLoot,
            "released boss loot becomes selectable by another player",
        );
        game.stop();

        // 普通搜打撤（暂不生成 Boss）与非搜打撤地图都不生成 Boss。
        Config.extractionSecret.enabled = false;
        Config.extractionBoss.bossPositions = {};
        const normalGame = new Game(
            `extraction-noboss-${Math.random().toString(36).slice(2)}`,
            { mapName: "extraction", teamMode: TeamMode.Solo },
        );
        assert.equal(
            bossPlayers(normalGame).length,
            0,
            "normal extraction must not spawn an AI boss",
        );
        normalGame.stop();

        const mainGame = new Game(
            `main-noboss-${Math.random().toString(36).slice(2)}`,
            { mapName: "main", teamMode: TeamMode.Solo },
        );
        assert.equal(
            bossPlayers(mainGame).length,
            0,
            "non-extraction maps must not spawn an AI boss",
        );
        mainGame.stop();

        console.log(
            "Extraction boss smoke test passed: captain-model AI boss, landmark spawn, fights back, drops weapon/loot/worn perk, secret-only.",
        );
    } finally {
        Config.extractionBoss = previousBoss;
        Config.extractionSecret = previousSecret;
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
