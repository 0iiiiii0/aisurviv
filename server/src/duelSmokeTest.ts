import assert from "assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { InputMsg } from "../../shared/net/inputMsg.ts";
import { JoinMsg } from "../../shared/net/joinMsg.ts";
import { MsgType } from "../../shared/net/net.ts";
import { SpectateMsg } from "../../shared/net/spectateMsg.ts";
import { Game } from "./game/game.ts";

function join(game: Game, socketId: string, token: string, name: string) {
    game.addJoinToken(token, true, 1);
    const msg = new JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = name;
    return game.playerBarn.addPlayer(socketId, msg);
}

async function main() {
    const closedSockets: string[] = [];
    const game = new Game(
        "duel-smoke-test",
        {
            mapName: "duel",
            teamMode: TeamMode.Solo,
            duelWeapons: ["ak47", "mosin"],
            duelBoost: 65,
            duelHelmetLevel: 3,
            duelChestLevel: 1,
            duelScope: "8xscope",
            duelThrowables: {
                frag: 4,
                mirv: 1,
                smoke: 2,
                strobe: 0,
                snowball: 6,
                potato: 3,
            },
        },
        () => {},
        (socketId) => closedSockets.push(socketId),
    );

    await game.init();

    assert.equal(game.map.width, 176);
    assert.equal(game.map.height, 136);
    assert.equal(game.map.mapDef.gameMode.maxPlayers, 2);
    assert.equal(game.map.mapDef.gameConfig.planes.timings.length, 0);
    assert.equal(game.map.objectCount.stone_01, 8);
    assert.equal(game.map.objectCount.crate_01, 6);
    assert.equal(game.map.objectCount.barrel_01, 4);
    assert.equal(game.map.objectCount.sandbags_01, 6);

    const first = join(game, "socket-red", "token-red", "Red");
    assert(first);
    assert.equal(game.started, false);
    assert.ok(Math.abs(first.pos.x - 35.2) < 1e-9);
    assert.equal(first.pos.y, 68);
    assert.equal(first.weapons[GameConfig.WeaponSlot.Primary].type, "ak47");
    assert.equal(first.weapons[GameConfig.WeaponSlot.Primary].ammo, 30);
    assert.equal(first.weapons[GameConfig.WeaponSlot.Secondary].type, "mosin");
    assert.equal(first.weapons[GameConfig.WeaponSlot.Secondary].ammo, 5);
    assert.equal(first.curWeapIdx, GameConfig.WeaponSlot.Primary);
    assert.equal(first.helmet, "helmet03");
    assert.equal(first.chest, "chest01");
    assert.equal(first.backpack, "backpack03");
    assert.equal(first.scope, "8xscope");
    assert.equal(first.inventory["8xscope"], 1);
    assert.equal(first.inventory["4xscope"], 0);
    assert.equal(first.boost, 65);
    assert.equal(first.inventory.frag, 4);
    assert.equal(first.inventory.mirv, 1);
    assert.equal(first.inventory.smoke, 2);
    assert.equal(first.inventory.strobe, 0);
    assert.equal(first.inventory.snowball, 6);
    assert.equal(first.inventory.potato, 3);
    assert.equal(first.weapons[GameConfig.WeaponSlot.Throwable].type, "snowball");
    assert.equal(first.hasPerk("endless_ammo"), true);
    for (const item of ["bandage", "healthkit", "soda", "painkiller"]) {
        assert.equal(first.inventory[item], GameConfig.inventoryInfiniteCount);
    }

    const waitingInput = new InputMsg();
    waitingInput.moveRight = true;
    waitingInput.shootStart = true;
    waitingInput.shootHold = true;
    first.handleInput(waitingInput);
    first.update(1);
    assert.ok(Math.abs(first.pos.x - 35.2) < 1e-9);
    assert.equal(first.pos.y, 68);
    assert.equal(first.zoom, first.scopeZoomRadius["8xscope"]);
    assert.equal(first.shootStart, false);
    assert.equal(first.shootHold, false);
    assert.equal(first.boost, 65);

    const second = join(game, "socket-blue", "token-blue", "Blue");

    assert(second);
    assert.ok(Math.abs(second.pos.x - 140.8) < 1e-9);
    assert.equal(second.pos.y, 68);
    assert.equal(first.pos.x + second.pos.x, game.map.width);
    assert.equal(game.started, true);
    assert.equal(game.canJoin, false);
    assert.equal(closedSockets.length, 0);

    game.addJoinToken("spectator-token", false, 1, 60_000, true);
    const spectatorMsg = new JoinMsg();
    spectatorMsg.protocol = GameConfig.protocolVersion;
    spectatorMsg.matchPriv = "spectator-token";
    spectatorMsg.name = "Admin Spectator";
    const spectator = game.playerBarn.addPlayer("socket-spectator", spectatorMsg);
    assert(spectator);
    assert.equal(spectator.dead, true);
    assert.equal(game.playerBarn.livingPlayers.length, 2);
    assert.ok(spectator.spectating === first || spectator.spectating === second);
    assert.equal(spectator.spectating?.spectatorCount, 1);
    const initialSpectateTarget = spectator.spectating;
    const nextSpectate = new SpectateMsg();
    nextSpectate.specNext = true;
    spectator.spectate(nextSpectate);
    assert.notEqual(spectator.spectating, initialSpectateTarget);
    const previousSpectate = new SpectateMsg();
    previousSpectate.specPrev = true;
    spectator.spectate(previousSpectate);
    assert.equal(spectator.spectating, initialSpectateTarget);

    assert.equal(game.gas.duration, 180);
    assert.equal(game.gas.damage, 8);
    assert(
        game.gas.damage / GameConfig.gas.damageTickRate > 1.75,
        "Duel gas must out-damage maximum adrenaline healing",
    );
    assert.deepEqual(game.gas.currentPos, { x: 88, y: 68 });
    assert.deepEqual(game.gas.posNew, { x: 88, y: 68 });
    const initialGasRadius = game.gas.currentRad;
    assert(initialGasRadius > 120);
    game.gas.update(180);
    assert.equal(game.gas.currentRad, 0);
    game.gas.resetForArenaRound();
    assert.equal(game.gas.currentRad, initialGasRadius);
    assert.equal(game.gas.duration, 180);
    assert.equal(game.gas.damage, 8);

    assert.equal(game.map.arenaObstacles.length, 24);
    assert.equal(game.map.arenaObstacles.every((obstacle) => obstacle.suppressLoot), true);
    const destroyedCover = game.map.arenaObstacles.find(
        (obstacle) => obstacle.type === "crate_01",
    );
    const damagedCover = game.map.arenaObstacles.find(
        (obstacle) => obstacle.type === "stone_01",
    );
    const permanentCover = game.map.arenaObstacles.find(
        (obstacle) => obstacle.type === "sandbags_01",
    );
    assert(destroyedCover);
    assert(damagedCover);
    assert(permanentCover);
    destroyedCover.damage({
        amount: 1000,
        damageType: GameConfig.DamageType.Player,
        dir: { x: 1, y: 0 },
        source: first,
        gameSourceType: first.activeWeapon,
    });
    damagedCover.damage({
        amount: 50,
        damageType: GameConfig.DamageType.Player,
        dir: { x: 1, y: 0 },
        source: first,
        gameSourceType: first.activeWeapon,
    });
    permanentCover.damage({
        amount: 1000,
        damageType: GameConfig.DamageType.Player,
        dir: { x: 1, y: 0 },
        source: first,
        gameSourceType: first.activeWeapon,
    });
    assert.equal(destroyedCover.dead, true);
    assert(damagedCover.health < damagedCover.maxHealth);
    assert.equal(permanentCover.destructible, false);
    assert.equal(permanentCover.dead, false);
    assert.equal(permanentCover.health, permanentCover.maxHealth);
    assert.equal(game.lootBarn.loots.length, 0);

    const activeInput = new InputMsg();
    activeInput.moveRight = true;
    first.handleInput(activeInput);
    first.update(0.1);
    assert(first.pos.x > 35.2);

    first.health = 50;
    first.useHealingItem("bandage");
    first.update(4);
    assert(first.health > 50);
    assert.equal(first.inventory.bandage, GameConfig.inventoryInfiniteCount);

    const winRound = (winner: typeof first, loser: typeof first) => {
        loser.damage({
            amount: 1000,
            damageType: GameConfig.DamageType.Player,
            dir: { x: 1, y: 0 },
            source: winner,
            gameSourceType: winner.activeWeapon,
        });
    };
    const beginNextRound = () => {
        assert(game.arenaMatch);
        game.arenaMatch.resetTicker = 0;
        game.update();
    };

    // Five complete rounds: Red wins rounds 1, 3 and 5; Blue wins 2 and 4.
    game.projectileBarn.addProjectile(
        first.__id,
        "strobe",
        { ...second.pos },
        0,
        0,
        { x: 1, y: 0 },
        10,
        GameConfig.DamageType.Player,
    );
    game.projectileBarn.update(0.01);
    game.planeBarn.addAirStrike({ ...second.pos }, { x: 1, y: 0 }, 0);
    let previousRoundAirstrikeFired = false;
    game.scheduleArenaRoundTimeout(() => {
        previousRoundAirstrikeFired = true;
    }, 20);
    assert.equal(game.projectileBarn.projectiles.length, 1);
    assert.equal(game.planeBarn.planes.length, 1);

    winRound(first, second);
    assert.equal(game.over, false);
    assert.equal(game.arenaMatch?.currentRound, 1);
    assert.equal(game.arenaMatch?.scores.get(first.__id), 1);
    assert.equal(second.dead, true);
    first.inventory.frag = 1;
    first.inventory.smoke = 0;
    const frozenWinnerPos = { ...first.pos };
    first.handleInput(activeInput);
    first.update(0.2);
    assert.deepEqual(first.pos, frozenWinnerPos);

    beginNextRound();
    assert.equal(game.projectileBarn.projectiles.length, 0);
    assert.equal(game.planeBarn.planes.length, 0);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(previousRoundAirstrikeFired, false);
    assert.equal(game.arenaMatch?.currentRound, 2);
    assert.equal(first.dead, false);
    assert.equal(second.dead, false);
    assert.equal(spectator.spectatorOnly, true);
    assert.equal(spectator.dead, true);
    assert.equal(spectator.health, 0);
    assert.equal(game.playerBarn.livingPlayers.includes(spectator), false);
    assert.ok(spectator.spectating === first || spectator.spectating === second);
    assert.ok(Math.abs(first.pos.x - 35.2) < 1e-9);
    assert.equal(first.pos.y, 68);
    assert.ok(Math.abs(second.pos.x - 140.8) < 1e-9);
    assert.equal(second.pos.y, 68);
    assert.equal(first.boost, 65);
    assert.equal(second.boost, 65);
    assert.equal(first.inventory.frag, 4);
    assert.equal(first.inventory.smoke, 2);
    assert.equal(first.weapons[GameConfig.WeaponSlot.Throwable].type, "snowball");
    assert.equal(destroyedCover.dead, false);
    assert.equal(destroyedCover.health, destroyedCover.maxHealth);
    assert.equal(damagedCover.health, damagedCover.maxHealth);
    assert.equal(game.lootBarn.loots.length, 0);
    assert.deepEqual(game.gas.currentPos, { x: 88, y: 68 });
    assert.deepEqual(game.gas.posNew, { x: 88, y: 68 });
    assert.equal(game.gas.currentRad, initialGasRadius);
    assert.equal(game.gas.duration, 180);

    winRound(second, first);
    beginNextRound();
    assert.equal(game.arenaMatch?.currentRound, 3);

    winRound(first, second);
    beginNextRound();
    assert.equal(game.arenaMatch?.currentRound, 4);

    winRound(second, first);
    beginNextRound();
    assert.equal(game.arenaMatch?.currentRound, 5);

    winRound(first, second);
    assert.equal(game.over, true);
    assert.equal(game.arenaMatch?.scores.get(first.__id), 3);
    assert.equal(game.arenaMatch?.scores.get(second.__id), 2);
    assert.equal(
        first.msgsToSend.some((msg) => msg.type === MsgType.GameOver),
        true,
    );
    assert.equal(
        second.msgsToSend.some((msg) => msg.type === MsgType.GameOver),
        true,
    );

    const noAdrenalineGame = new Game(
        "duel-no-adrenaline-smoke-test",
        {
            mapName: "duel",
            teamMode: TeamMode.Solo,
            duelWeapons: ["ak47", "m39"],
            duelAdrenalineEnabled: false,
            duelBoost: 100,
            duelHelmetLevel: 2,
            duelChestLevel: 2,
            duelThrowables: { frag: 0, mirv: 0, smoke: 0, strobe: 0, snowball: 0, potato: 0 },
        },
        () => {},
        () => {},
    );
    await noAdrenalineGame.init();
    const noBoostPlayer = join(noAdrenalineGame, "socket-no-boost", "token-no-boost", "No Boost");
    assert(noBoostPlayer);
    assert.equal(noBoostPlayer.boost, 0);
    assert.equal(noBoostPlayer.inventory.soda, 0);
    assert.equal(noBoostPlayer.inventory.painkiller, 0);
    assert.equal(noBoostPlayer.inventory.bandage, GameConfig.inventoryInfiniteCount);
    assert.equal(noBoostPlayer.inventory.healthkit, GameConfig.inventoryInfiniteCount);
    noAdrenalineGame.stop();

    const flareGame = new Game(
        "duel-flare-smoke-test",
        {
            mapName: "duel",
            teamMode: TeamMode.Solo,
            duelWeapons: ["flare_gun", "flare_gun_dual"],
            duelBoost: 0,
            duelHelmetLevel: 0,
            duelChestLevel: 0,
            duelThrowables: {
                frag: 0,
                mirv: 0,
                smoke: 0,
                strobe: 0,
                snowball: 0,
                potato: 0,
            },
        },
        () => {},
        () => {},
    );
    await flareGame.init();
    const flarePlayer = join(flareGame, "socket-flare-red", "token-flare-red", "Flare Red");
    join(flareGame, "socket-flare-blue", "token-flare-blue", "Flare Blue");
    assert(flarePlayer);
    assert.equal(flarePlayer.boost, 0);
    assert.equal(flarePlayer.helmet, "");
    assert.equal(flarePlayer.chest, "");
    assert.equal(flarePlayer.weapons[GameConfig.WeaponSlot.Throwable].type, "");
    assert.equal(flarePlayer.activeWeapon, "flare_gun");
    flarePlayer.weaponManager.fireWeapon(false);
    assert.equal(flareGame.bulletBarn.bullets.length, 1);
    assert.equal(flareGame.planeBarn.planes.length, 0);

    flarePlayer.weaponManager.setCurWeapIndex(
        GameConfig.WeaponSlot.Secondary,
        true,
        true,
        true,
    );
    assert.equal(flarePlayer.activeWeapon, "flare_gun_dual");
    flarePlayer.weaponManager.fireWeapon(false);
    assert.equal(flareGame.bulletBarn.bullets.length, 2);
    assert.equal(flareGame.planeBarn.planes.length, 0);

    const brokenArrowGame = new Game(
        "duel-broken-arrow-smoke-test",
        {
            mapName: "duel",
            teamMode: TeamMode.Solo,
            duelWeapons: ["spas12", "vector"],
            duelThrowables: {
                frag: 0,
                mirv: 0,
                smoke: 0,
                strobe: 4,
                snowball: 0,
                potato: 0,
            },
        },
        () => {},
        () => {},
    );
    await brokenArrowGame.init();
    const brokenArrowPlayer = join(
        brokenArrowGame,
        "socket-broken-arrow-red",
        "token-broken-arrow-red",
        "Broken Arrow Red",
    );
    join(
        brokenArrowGame,
        "socket-broken-arrow-blue",
        "token-broken-arrow-blue",
        "Broken Arrow Blue",
    );
    assert(brokenArrowPlayer);
    assert.equal(brokenArrowPlayer.inventory.strobe, 4);
    assert.equal(
        brokenArrowPlayer.hasPerk("broken_arrow"),
        false,
        "configured strobe inventory must not grant the Broken Arrow perk",
    );
    brokenArrowGame.stop();

    console.log(
        `Duel smoke test passed: ${game.map.width}x${game.map.height}, ` +
            `${game.playerBarn.players.length} players, five rounds, final score 3:2; ` +
            `round-bound airstrikes are cleared; single and dual flare guns are safe.`,
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
