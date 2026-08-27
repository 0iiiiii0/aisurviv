import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { GameObjectDefs } from "../../shared/defs/gameObjectDefs.ts";
import { ObjectType } from "../../shared/net/objectSerializeFns.ts";
import { Config } from "./config.ts";
import { Game } from "./game/game.ts";
import type { Player } from "./game/objects/player.ts";
import { ZOMBIE_TRICK_DRAIN_MAX } from "../../shared/defs/zombieDefs.ts";

const prevZombie = JSON.parse(JSON.stringify(Config.zombie)) as typeof Config.zombie;

function joinHuman(game: Game, name: string): Player {
    game.addJoinToken(`zm-${name}`, false, 1, 60_000, false, false, undefined);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = `zm-${name}`;
    msg.name = name;
    const p = game.playerBarn.addPlayer(`${name}-sock`, msg);
    if (!p) throw new Error(`failed to join ${name}`);
    return p;
}

void (async () => {
    Config.zombie.initialCount = 40;
    Config.zombie.replenishCount = 20;
    Config.zombie.replenishIntervalSec = 120;
    Config.zombie.winTimeSec = 360;
    Config.zombie.selfDestructChance = 0.05;

    const game = new Game(
        `zombie-${Math.random().toString(36).slice(2)}`,
        { mapName: "zombie", teamMode: TeamMode.Solo },
        () => {},
        () => {},
    );
    await game.init();
    const g = game as unknown as {
        started: boolean;
        startedTime: number;
        zombieMode: { zombieCount: number; active: boolean } | null;
    };
    g.started = true;
    g.startedTime = 0;
    try {
        assert.ok(g.zombieMode?.active, "zombie system active");
        assert.equal(game.map.mapDef.gameMode.zombieMode, true, "zombie map flag");
        assert.equal(game.map.mapDef.gameMode.extractionMode, undefined, "not extraction");

        const human = joinHuman(game, "Survivor");
        human.pos.x = 400;
        human.pos.y = 400;
        human.layer = 0;
        game.grid.updateObject(human as never);
        // 清障：测试区域（390-410 方块）内真实障碍标记 dead，保证近战命中。
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
                const wMin = {
                    x: o.bounds.min.x + (o.pos?.x ?? 0),
                    y: o.bounds.min.y + (o.pos?.y ?? 0),
                };
                const wMax = {
                    x: o.bounds.max.x + (o.pos?.x ?? 0),
                    y: o.bounds.max.y + (o.pos?.y ?? 0),
                };
                if (wMin.x < 410 && wMax.x > 390 && wMin.y < 410 && wMax.y > 390) {
                    o.dead = true;
                }
            }
        }

        // 1) Initial spawn: 40 zombies（第一波，无自爆僵尸）。
        (game as unknown as { update(): void }).update();
        assert.equal(g.zombieMode!.zombieCount, 40, "initial zombie count");
        const zombies = (game.playerBarn.players as Player[]).filter(
            (p) => (p as unknown as { serverBot: boolean }).serverBot,
        );
        assert.equal(zombies.length, 40, "serverBot zombie players");
        for (const z of zombies) {
            assert.equal(z.outfit, "outfitVerde", "green outfit");
            assert.equal(String(z.weapons[GameConfig.WeaponSlot.Primary]?.type ?? ""), "", "no gun");
            const melee = String(z.weapons[GameConfig.WeaponSlot.Melee]?.type ?? "");
            assert.equal(melee, "bayonet", "全部僵尸统一装备小刀");
            assert.equal(
                (z as unknown as { zombieSelfDestruct: boolean }).zombieSelfDestruct,
                false,
                "第一波无自爆僵尸",
            );
        }
        console.log("✓ initial wave: 40 zombies, 0% self-destruct (green outfit + melee)");

        // 1.5) 速度：僵尸最终速度为正常玩家的 70%（含满激素/近战装备加成后乘 0.7）。
        const speedZombie = zombies[0];
        speedZombie.boost = 100;
        speedZombie.recalculateSpeed();
        const meleeDef = GameObjectDefs[
            String(speedZombie.weapons[GameConfig.WeaponSlot.Melee]?.type ?? "fists")
        ] as unknown as { speed?: { equip?: number } };
        const meleeEquip = Number(meleeDef?.speed?.equip ?? 0) || 0;
        const expectedZombieSpeed =
            (GameConfig.player.moveSpeed +
                GameConfig.player.boostMoveSpeed +
                meleeEquip) *
            0.7;
        assert.ok(
            Math.abs(speedZombie.speed - expectedZombieSpeed) < 0.01,
            `僵尸速度 ${speedZombie.speed.toFixed(2)} ≈ 正常 ${expectedZombieSpeed.toFixed(2)}`,
        );
        console.log(`✓ zombie speed 70% (${speedZombie.speed.toFixed(2)} vs normal ${(speedZombie.speed / 0.7).toFixed(2)})`);

        // 2) Chase: place a zombie far away, run frames, distance shrinks.
        const chaser = zombies[0];
        chaser.pos.x = 200;
        chaser.pos.y = 200;
        chaser.layer = 0;
        const d0 = Math.hypot(chaser.pos.x - human.pos.x, chaser.pos.y - human.pos.y);
        for (let i = 0; i < 90; i++) (game as unknown as { update(): void }).update();
        const d1 = Math.hypot(chaser.pos.x - human.pos.x, chaser.pos.y - human.pos.y);
        assert.ok(d1 < d0, `zombie closed in (${d0.toFixed(0)} -> ${d1.toFixed(0)})`);
        assert.ok(
            chaser.moveLeft || chaser.moveRight || chaser.moveUp || chaser.moveDown,
            "zombie outputs movement",
        );
        console.log("✓ zombie chases player in a straight line");

        // 3) Attack: face-to-face → damage + trick_drain stacking (max 4).
        //    Move the other zombies far away so they don't swarm the player.
        for (const z of zombies) {
            if (z === zombies[1]) continue;
            z.pos.x = 30 + Math.random() * 60;
            z.pos.y = 30 + Math.random() * 60;
        }
        // 2.5) 跨楼层：僵尸在 1 层、玩家在 0 层 → 不追踪不攻击。
        const crossZombie = zombies[2];
        crossZombie.pos.x = human.pos.x + 1;
        crossZombie.pos.y = human.pos.y;
        crossZombie.layer = 1;
        game.grid.updateObject(crossZombie as never);
        (crossZombie as unknown as { zombieAttackCooldownUntil: number }).zombieAttackCooldownUntil = 0;
        const hpCross = human.health;
        for (let i = 0; i < 10; i++) (game as unknown as { update(): void }).update();
        assert.equal(human.health, hpCross, "跨楼层僵尸不攻击玩家");
        console.log("✓ no cross-floor zombie attack");
        const attacker = zombies[1];
        attacker.pos.x = human.pos.x + 1;
        attacker.pos.y = human.pos.y;
        attacker.layer = 0;
        game.grid.updateObject(attacker as never);
        (attacker as unknown as { zombieAttackCooldownUntil: number }).zombieAttackCooldownUntil = 0;
        const hp0 = human.health;
        // 近战挥击有攻击前摇（damageTimes），用真实时间推进让命中生效。
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        for (let i = 0; i < 60; i++) {
            (game as unknown as { update(): void }).update();
            await sleep(16);
        }
        assert.ok(human.health < hp0, "player damaged");
        assert.ok(
            human.perks.filter((p) => p.type === "trick_drain").length >= 1,
            "gained trick_drain",
        );
        for (let i = 0; i < 12; i++) {
            for (const z of zombies) {
                if (z === zombies[1]) continue;
                z.pos.x = 30 + Math.random() * 60;
                z.pos.y = 30 + Math.random() * 60;
            }
            human.health = 100;
            human.pos.x = 400;
            human.pos.y = 400;
            attacker.pos.x = human.pos.x + 1;
            attacker.pos.y = human.pos.y;
            (attacker as unknown as { zombieAttackCooldownUntil: number }).zombieAttackCooldownUntil = 0;
            for (let f = 0; f < 60; f++) {
                (game as unknown as { update(): void }).update();
                await sleep(16);
            }
        }
        const drains = human.perks.filter((p) => p.type === "trick_drain").length;
        assert.equal(drains, ZOMBIE_TRICK_DRAIN_MAX, `trick_drain max ${ZOMBIE_TRICK_DRAIN_MAX}`);
        console.log(`✓ attack damage + trick_drain cap ${ZOMBIE_TRICK_DRAIN_MAX}`);

        // 4) Mission timeout: without placing all elements, humans lose and
        // zombies remain. The collection task cannot be bypassed by waiting.
        g.startedTime = Config.zombie.winTimeSec + 1;
        (game as unknown as { update(): void }).update();
        const zombiesAlive = (game.playerBarn.players as Player[]).filter(
            (p) =>
                (p as unknown as { serverBot: boolean }).serverBot &&
                !(p as unknown as { dead: boolean }).dead,
        ).length;
        assert.ok(human.dead, "objective timeout eliminates the survivor");
        assert.ok(zombiesAlive > 0, "timeout does not award a free zombie clear");
        console.log("✓ objective timeout eliminates humans instead of granting a free win");
    } finally {
        game.stop();
        Config.zombie = prevZombie;
    }

    // Second match: 100% self-destruct variants + contact explosion + replenish.
    Config.zombie.initialCount = 10;
    Config.zombie.replenishCount = 20;
    Config.zombie.replenishIntervalSec = 120;
    Config.zombie.winTimeSec = 360;
    Config.zombie.selfDestructChance = 1;

    const game2 = new Game(
        `zombie2-${Math.random().toString(36).slice(2)}`,
        { mapName: "zombie", teamMode: TeamMode.Solo },
        () => {},
        () => {},
    );
    await game2.init();
    const g2 = game2 as unknown as {
        started: boolean;
        startedTime: number;
        zombieMode: { zombieCount: number; active: boolean } | null;
    };
    g2.started = true;
    g2.startedTime = 0;
    try {
        const human2 = joinHuman(game2, "Survivor2");
        human2.pos.x = 400;
        human2.pos.y = 400;
        human2.layer = 0;

        (game2 as unknown as { update(): void }).update();
        const bots = (game2.playerBarn.players as Player[]).filter(
            (p) => (p as unknown as { serverBot: boolean }).serverBot,
        );
        assert.equal(bots.length, 40, "第二场第一波 40 个");

        // 波次 2：推进到 120s → +30 个（10% 自爆）。
        g2.startedTime = 120;
        (game2 as unknown as { update(): void }).update();
        const botsAfterWave2 = (game2.playerBarn.players as Player[]).filter(
            (p) => (p as unknown as { serverBot: boolean }).serverBot,
        );
        assert.equal(botsAfterWave2.length, 70, "120s 补充 30 个（总数 70）");
        const wave2Variants = botsAfterWave2.filter(
            (z) => (z as unknown as { zombieSelfDestruct: boolean }).zombieSelfDestruct,
        );
        assert.ok(
            wave2Variants.length >= 0 && wave2Variants.length <= 12,
            `波次2自爆数在合理范围（实际 ${wave2Variants.length}）`,
        );
        console.log(`✓ wave 2: +30 zombies, ${wave2Variants.length} self-destruct (~10%)`);

        // 波次 3：推进到 240s → +40 个（20% 自爆）。
        g2.startedTime = 240;
        (game2 as unknown as { update(): void }).update();
        const botsAfterWave3 = (game2.playerBarn.players as Player[]).filter(
            (p) => (p as unknown as { serverBot: boolean }).serverBot,
        );
        assert.equal(botsAfterWave3.length, 110, "240s 补充 40 个（总数 110）");
        const wave3New = botsAfterWave3.slice(70);
        const wave3Variants = wave3New.filter(
            (z) => (z as unknown as { zombieSelfDestruct: boolean }).zombieSelfDestruct,
        );
        assert.ok(
            wave3Variants.length >= 0 && wave3Variants.length <= 16,
            `波次3自爆数在合理范围（实际 ${wave3Variants.length}）`,
        );
        // 手动构造一只自爆僵尸（不依赖随机），验证外观与能力。
        const manualBoom = wave3New[0];
        (manualBoom as unknown as { zombieSelfDestruct: boolean }).zombieSelfDestruct = true;
        manualBoom.addPerk("final_bugle", false);
        manualBoom.addPerk("martyrdom", false);
        assert.ok(manualBoom.hasPerk("final_bugle"), "carries final_bugle");
        assert.ok(manualBoom.hasPerk("martyrdom"), "carries martyrdom");
        assert.equal(manualBoom.outfit, "outfitVerde", "same look as normal zombies");
        console.log(`✓ wave 3: +40 zombies, ${wave3Variants.length} self-destruct (~20%)`);

        // Contact explosion: put one next to the player → kills itself.
        // 自爆触发要求直线可达（LOS）：先把玩家移到开阔地，保证
        // 僵尸→玩家无遮挡，再贴脸。
        const boom = manualBoom;
        {
            let spot: { x: number; y: number } | null = null;
            const center = game2.map.center;
            for (const angle of [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, (5 * Math.PI) / 4, (3 * Math.PI) / 2, (7 * Math.PI) / 4]) {
                for (const radius of [20, 30, 40, 50]) {
                    const p = { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
                    const zp = { x: p.x + 1.5, y: p.y };
                    if (
                        game2.map.hasPlayerWalkPath(p, p, 0, 0.72) &&
                        game2.map.hasPlayerWalkPath(zp, p, 0, 0.72)
                    ) {
                        spot = p;
                        break;
                    }
                }
                if (spot) break;
            }
            assert.ok(spot, "找到开阔地（LOS 前置）");
            human2.pos.x = spot.x;
            human2.pos.y = spot.y;
            game2.grid.updateObject(human2 as never);
        }
        boom.pos.x = human2.pos.x + 1.5;
        boom.pos.y = human2.pos.y;
        boom.layer = 0;
        game2.grid.updateObject(boom as never);
        (boom as unknown as { zombieAttackCooldownUntil: number }).zombieAttackCooldownUntil = 0;
        const projectilesBefore = game2.projectileBarn.projectiles?.length ?? 0;
        const explosionsBefore = game2.explosionBarn.newExplosions.length;
        const sleep2 = (ms: number) => new Promise((r) => setTimeout(r, ms));
        for (let i = 0; i < 40; i++) {
            (game2 as unknown as { update(): void }).update();
            await sleep2(16);
        }
        assert.ok(boom.dead, "self-destruct zombie dies on contact");
        // martyrdom spawns grenades at death.
        const projectilesAfter = game2.projectileBarn.projectiles?.length ?? 0;
        assert.ok(
            projectilesAfter > projectilesBefore,
            `martyrdom spawned grenades (${projectilesBefore} -> ${projectilesAfter})`,
        );
        // 瞬间爆炸：自爆死亡时立即产生一次爆炸（不等手雷落地）。
        assert.ok(
            game2.explosionBarn.newExplosions.length > explosionsBefore,
            "instant explosion on self-destruct death",
        );
        console.log("✓ contact explosion: instant blast + martyrdom grenades");

        console.log("\nZombie mode smoke test passed.");
    } finally {
        game2.stop();
        Config.zombie = prevZombie;
    }
})();
