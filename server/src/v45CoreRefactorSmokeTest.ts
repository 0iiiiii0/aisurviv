import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Game } from "./game/game.ts";
import {
    chooseDodgeDirection,
    planForbiddenCounterStrobes,
    type ForbiddenBulletSnapshot,
} from "./bot/forbiddenCombat.ts";

async function main(): Promise<void> {
    const sent: Array<{ socketId: string; bytes: number }> = [];
    const game = new Game(
        "v45-aim-internal-target",
        {
            mapName: "aim_training",
            teamMode: TeamMode.Solo,
            privateGame: true,
            aimTrainingWeapon: "ak47",
            aimTrainingInfiniteMagazine: true,
            aimTrainingTargetBoost: 75,
            aimTrainingDistance: 80,
        },
        (socketId, data) => sent.push({ socketId, bytes: data.byteLength }),
        () => {},
    );
    await game.init();

    const target = game.playerBarn.players.find((player) => player.internalTrainingTarget);
    assert(target, "aim-training room must create its target inside the game process");
    assert.equal(target.serverBot, true);
    assert.equal(target.trainingTarget, true);
    assert.equal(game.serverBotCount, 1);
    assert.equal(game.humanPlayerCount, 0);

    game.addJoinToken("v45-human-token", false, 1, 60_000, false, false);
    const join = new net.JoinMsg();
    join.protocol = GameConfig.protocolVersion;
    join.matchPriv = "v45-human-token";
    join.name = "V45 Trainer";
    join.loadout.outfit = "outfitBase";
    join.loadout.melee = "fists";
    join.loadout.heal = "heal_basic";
    join.loadout.boost = "boost_basic";
    const human = game.playerBarn.addPlayer("v45-human-socket", join);
    assert(human);
    assert.equal(game.playerBarn.livingPlayers.length, 2);
    assert.equal(human.trainingTarget, false);
    assert.equal(human.spectatorOnly, false);
    assert.equal(human.weapons[GameConfig.WeaponSlot.Primary].type, "ak47");
    assert.equal(human.spectating, undefined);

    const beforeY = target.pos.y;
    target.update(0.45);
    assert.notEqual(target.pos.y, beforeY, "server-owned target must move without a smartBot process");
    assert.equal(target.health, GameConfig.player.health);
    assert.equal(target.shootStart, false);
    assert.equal(target.shootHold, false);

    const avoidable: ForbiddenBulletSnapshot[] = [{
        id: 1,
        playerId: 2,
        pos: { x: 30, y: 50 },
        dir: { x: 1, y: 0 },
        speed: 35,
        damage: 70,
        remainingDistance: 80,
        bulletType: "test",
        layer: 0,
    }];
    const dodge = chooseDodgeDirection({
        botPos: { x: 50, y: 50 },
        botRadius: 1,
        botLayer: 0,
        botPlayerId: 1,
        botMoveSpeed: 12,
        bullets: avoidable,
        targetPos: { x: 70, y: 50 },
        mapWidth: 100,
        mapHeight: 100,
        obstacles: [],
    });
    assert(dodge);
    assert(dodge.avoidedHits >= 1);
    assert.equal(dodge.remainingHits, 0);
    assert(dodge.minimumSeparation > dodge.stationarySeparation);

    const unavoidable: ForbiddenBulletSnapshot[] = [{
        id: 2,
        playerId: 2,
        pos: { x: 49.1, y: 50 },
        dir: { x: 1, y: 0 },
        speed: 120,
        damage: 90,
        remainingDistance: 40,
        bulletType: "test",
        layer: 0,
    }];
    assert.equal(
        chooseDodgeDirection({
            botPos: { x: 50, y: 50 },
            botRadius: 1,
            botLayer: 0,
            botPlayerId: 1,
            botMoveSpeed: 12,
            bullets: unavoidable,
            targetPos: { x: 70, y: 50 },
            mapWidth: 100,
            mapHeight: 100,
            obstacles: [],
        }),
        null,
        "an unavoidable impact must not interrupt HACKER/LEGIT gunfire",
    );

    assert.deepEqual(planForbiddenCounterStrobes(2), {
        barrageCount: 0,
        reserveCount: 2,
        carpet: false,
    });
    assert.deepEqual(planForbiddenCounterStrobes(3), {
        barrageCount: 0,
        reserveCount: 3,
        carpet: false,
    });
    assert.deepEqual(planForbiddenCounterStrobes(99, 5), {
        barrageCount: 4,
        reserveCount: 95,
        carpet: true,
    });

    const projectRoot = path.resolve(__dirname, "../..");
    const gameServer = fs.readFileSync(path.join(projectRoot, "server/src/gameServer.ts"), "utf8");
    const smartBot = fs.readFileSync(path.join(projectRoot, "server/src/smartBot.ts"), "utf8") + "\n" + fs.readFileSync(path.join(projectRoot, "server/src/bot/smartBotSupport.ts"), "utf8");
    const ui2 = fs.readFileSync(path.join(projectRoot, "client/src/ui/ui2.ts"), "utf8");
    const input = fs.readFileSync(path.join(projectRoot, "client/src/input.ts"), "utf8");
    assert.doesNotMatch(gameServer, /launchAimTrainingTarget/);
    assert.doesNotMatch(gameServer, /superviseAimTrainingTarget/);
    assert.match(smartBot, /hostilePressure[\s\S]*airstrike_counter_armed/);
    assert.match(smartBot, /cookMs: 120/);
    assert.match(smartBot, /counterStrobe \? 360 : 420/);
    assert.match(smartBot, /this\.difficulty === "forbidden" \|\| this\.difficulty === "legit"[\s\S]*handleForbiddenCombat/);
    assert.match(smartBot, /urgentDodge\.avoidedHits > 0/);
    assert.match(ui2, /target instanceof HTMLInputElement[\s\S]*return;/);
    assert.match(input, /target instanceof HTMLInputElement[\s\S]*return;/);

    game.stop();
    console.log(
        "V45 core refactor smoke test passed: internal aim target, proven-only LEGIT/HACKER dodge, bounded airstrike counter-barrage, and spectator chat fullscreen guard.",
    );
}

void main();
