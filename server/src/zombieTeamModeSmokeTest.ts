import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { GameObjectDefs } from "../../shared/defs/gameObjectDefs.ts";
import { ZOMBIE_DIFFICULTY_PRESETS } from "../../shared/defs/zombieDefs.ts";
import { Config } from "./config.ts";
import { Game } from "./game/game.ts";
import type { Player } from "./game/objects/player.ts";

const prevZombie = JSON.parse(JSON.stringify(Config.zombie)) as typeof Config.zombie;

function join(game: Game, name: string, groupId: number, socketId: string): Player {
    game.addJoinToken(`zt-${name}`, false, 1, 60_000, false, false, undefined);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = `zt-${name}`;
    msg.name = name;
    msg.loadoutPriv = "";
    const p = game.playerBarn.addPlayer(socketId, msg);
    if (!p) throw new Error(`failed to join ${name}`);
    (p as unknown as { groupId: number }).groupId = groupId;
    return p;
}

void (async () => {
    assert.deepEqual(
        Object.fromEntries(
            Object.entries(ZOMBIE_DIFFICULTY_PRESETS).map(([difficulty, preset]) => [
                difficulty,
                preset.speedMult,
            ]),
        ),
        { simple: 0.6, normal: 0.7, hard: 0.9 },
        "僵尸难度必须恢复为简单 60%、普通 70%、困难 90%",
    );
    Config.zombie.initialCount = 6;
    Config.zombie.replenishCount = 0;
    Config.zombie.replenishIntervalSec = 120;
    Config.zombie.winTimeSec = 360;
    Config.zombie.selfDestructChance = 0;

    const game = new Game(
        `zombie-duo-${Math.random().toString(36).slice(2)}`,
        { mapName: "zombie", teamMode: TeamMode.Duo },
        () => {},
        () => {},
    );
    await game.init();
    const g = game as unknown as {
        started: boolean;
        startedTime: number;
        zombieMode: { zombieCount: number; active: boolean } | null;
        checkGameOver(): void;
        over: boolean;
    };
    g.started = true;
    g.startedTime = 0;
    try {
        assert.ok(g.zombieMode?.active, "duo zombie system active");
        assert.equal(game.teamMode, TeamMode.Duo, "duo team mode");

        // 组队两人进入（同组）。
        const a = join(game, "DuoA", 100, "duo-a-sock");
        const b = join(game, "DuoB", 100, "duo-b-sock");
        a.pos.x = 400; a.pos.y = 400; a.layer = 0;
        b.pos.x = 405; b.pos.y = 400; b.layer = 0;

        (game as unknown as { update(): void }).update();
        assert.equal(
            g.zombieMode!.zombieCount,
            ZOMBIE_DIFFICULTY_PRESETS.normal.initialCount,
            "组队房间也生成僵尸（普通难度默认数量）",
        );

        // 一人死亡 → 另一人存活 → 游戏不结束。
        a.kill({
            amount: 9999,
            damageType: GameConfig.DamageType.Player,
            dir: { x: 1, y: 0 },
            source: undefined,
        });
        g.checkGameOver();
        assert.equal(g.over, false, "组队一人死亡游戏不结束");
        console.log("✓ duo: one dead, one alive → match continues");

        // 全队死亡 → 结束。
        b.kill({
            amount: 9999,
            damageType: GameConfig.DamageType.Player,
            dir: { x: 1, y: 0 },
            source: undefined,
        });
        g.checkGameOver();
        assert.equal(g.over, true, "全队死亡游戏结束");
        console.log("✓ duo: all humans dead → match ends");

        console.log("\nZombie duo/squad team mode test passed.");
    } finally {
        game.stop();
        Config.zombie = prevZombie;
    }


    // Regression: a single human starting Zombie Squad with auto-fill enabled
    // must never have spawned zombies consume the three open squad slots.
    const squadGame = new Game(
        `zombie-squad-isolation-${Math.random().toString(36).slice(2)}`,
        { mapName: "zombie", teamMode: TeamMode.Squad },
        () => {},
        () => {},
    );
    await squadGame.init();
    const sg = squadGame as unknown as {
        started: boolean;
        startedTime: number;
        zombieMode: { zombieCount: number; active: boolean } | null;
    };
    sg.started = true;
    sg.startedTime = 0;
    try {
        squadGame.addJoinToken(
            "zombie-squad-human",
            true,
            1,
            60_000,
            false,
            false,
            undefined,
        );
        const msg = new net.JoinMsg();
        msg.protocol = GameConfig.protocolVersion;
        msg.matchPriv = "zombie-squad-human";
        msg.name = "SquadHuman";
        msg.loadoutPriv = "";
        const human = squadGame.playerBarn.addPlayer("zombie-squad-human-sock", msg);
        assert.ok(human, "single survivor joins zombie squad");

        human.pos.x = 400;
        human.pos.y = 400;
        human.layer = 0;
        (squadGame as unknown as { update(): void }).update();

        const zombies = (squadGame.playerBarn.players as Player[]).filter(
            (player) => player.serverBot,
        );
        assert.ok(zombies.length > 0, "zombie squad spawns hostile zombies");
        for (const zombie of zombies) {
            assert.notEqual(
                zombie.groupId,
                human.groupId,
                "zombie must not occupy survivor squad group",
            );
            assert.notEqual(
                zombie.teamId,
                human.teamId,
                "zombie must not inherit survivor squad teamId",
            );
        }
        assert.equal(
            (squadGame.playerBarn.players as Player[]).filter(
                (player) => !player.serverBot && player.groupId === human.groupId,
            ).length,
            1,
            "survivor squad remains human-only after zombie spawn",
        );
        console.log(
            `✓ squad isolation: 1 human + ${zombies.length} zombies, no mixed group/team`,
        );
    } finally {
        squadGame.stop();
        Config.zombie = prevZombie;
    }

    // 难度快照：simple 房间初始 30 只僵尸，速度倍率 0.6。
    const hardGame = new Game(
        `zombie-simple-${Math.random().toString(36).slice(2)}`,
        { mapName: "zombie", teamMode: TeamMode.Solo, zombieDifficulty: "simple" },
        () => {},
        () => {},
    );
    await hardGame.init();
    const hg = hardGame as unknown as {
        started: boolean;
        startedTime: number;
        zombieMode: { zombieCount: number; active: boolean } | null;
    };
    hg.started = true;
    hg.startedTime = 0;
    try {
        const h = join(hardGame, "SoloH", 0, "solo-h-sock");
        h.pos.x = 400; h.pos.y = 400; h.layer = 0;
        (hardGame as unknown as { update(): void }).update();
        assert.equal(hg.zombieMode!.zombieCount, 30, "简单难度初始 30 只");
        const z = (hardGame.playerBarn.players as Player[]).find(
            (p) => (p as unknown as { serverBot: boolean }).serverBot,
        );
        assert.ok(z, "僵尸存在");
        z.boost = 100;
        z.recalculateSpeed();
        const meleeDef = GameObjectDefs[
            String(z.weapons[GameConfig.WeaponSlot.Melee]?.type ?? "fists")
        ] as unknown as { speed?: { equip?: number } };
        const meleeEquip = Number(meleeDef?.speed?.equip ?? 0) || 0;
        const simple = ZOMBIE_DIFFICULTY_PRESETS.simple.speedMult;
        const simpleSpeed =
            (GameConfig.player.moveSpeed +
                GameConfig.player.boostMoveSpeed +
                meleeEquip) *
            simple;
        assert.ok(
            Math.abs(z.speed - simpleSpeed) < 0.01,
            `简单难度速度 ${z.speed.toFixed(2)} ≈ ${simpleSpeed.toFixed(2)}`,
        );
        assert.equal(simple, 0.6, "简单难度僵尸速度倍率为 60%");
        assert.equal(
            ZOMBIE_DIFFICULTY_PRESETS.simple.selfDestructChance,
            0,
            "简单难度预设必须是 0% 自爆",
        );
        const simpleZombies = (hardGame.playerBarn.players as Player[]).filter(
            (player) => player.serverBot,
        );
        assert.ok(
            simpleZombies.every((player) => !player.zombieSelfDestruct),
            "简单难度初始僵尸必须全部不是自爆僵尸",
        );
        // 双保险回归：即使某调用方错误传入 100% 自爆概率，最终生成点也必须
        // 遵守简单难度“完全无自爆”的硬规则。
        const beforeForcedSpawn = simpleZombies.length;
        (hg.zombieMode as unknown as { spawnZombie(chance: number): void }).spawnZombie(1);
        const forcedZombie = (hardGame.playerBarn.players as Player[])
            .filter((player) => player.serverBot)
            .slice(beforeForcedSpawn)[0];
        assert.ok(forcedZombie, "简单难度强制生成回归僵尸存在");
        assert.equal(
            forcedZombie.zombieSelfDestruct,
            false,
            "简单难度即使收到 100% 概率也不得生成自爆僵尸",
        );
        console.log(`✓ simple difficulty: 0% self-destruct, 30 initial zombies, speed ${simple * 100}%`);
        console.log("\nZombie difficulty snapshot test passed.");
    } finally {
        hardGame.stop();
        Config.zombie = prevZombie;
    }

    // 困难难度必须在真实 Player.recalculateSpeed 路径中使用 90%。
    const hardSpeedGame = new Game(
        `zombie-hard-speed-${Math.random().toString(36).slice(2)}`,
        { mapName: "zombie", teamMode: TeamMode.Solo, zombieDifficulty: "hard" },
        () => {},
        () => {},
    );
    await hardSpeedGame.init();
    const hardState = hardSpeedGame as unknown as {
        started: boolean;
        startedTime: number;
    };
    hardState.started = true;
    hardState.startedTime = 0;
    try {
        const survivor = join(hardSpeedGame, "HardSpeedHuman", 0, "hard-speed-human-sock");
        survivor.pos.x = 400;
        survivor.pos.y = 400;
        survivor.layer = 0;
        (hardSpeedGame as unknown as { update(): void }).update();
        const zombie = (hardSpeedGame.playerBarn.players as Player[]).find(
            (player) => (player as unknown as { serverBot: boolean }).serverBot,
        );
        assert.ok(zombie, "困难模式僵尸存在");
        zombie.boost = 100;
        zombie.recalculateSpeed();
        const meleeDef = GameObjectDefs[
            String(zombie.weapons[GameConfig.WeaponSlot.Melee]?.type ?? "fists")
        ] as unknown as { speed?: { equip?: number } };
        const meleeEquip = Number(meleeDef?.speed?.equip ?? 0) || 0;
        const hardMultiplier = ZOMBIE_DIFFICULTY_PRESETS.hard.speedMult;
        const unscaledSpeed =
            GameConfig.player.moveSpeed +
            GameConfig.player.boostMoveSpeed +
            meleeEquip;
        assert.equal(hardMultiplier, 0.9, "困难僵尸速度倍率为 90%");
        assert.ok(
            Math.abs(zombie.speed - unscaledSpeed * hardMultiplier) < 0.01,
            `困难僵尸速度 ${zombie.speed.toFixed(2)} ≈ ${(
                unscaledSpeed * hardMultiplier
            ).toFixed(2)}`,
        );
        console.log(
            `✓ hard difficulty zombie speed: ${hardMultiplier * 100}% (${zombie.speed.toFixed(2)} vs base ${unscaledSpeed.toFixed(2)})`,
        );
    } finally {
        hardSpeedGame.stop();
        Config.zombie = prevZombie;
    }
})();
