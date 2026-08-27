import assert from "assert/strict";
import { ObjectType } from "../../shared/net/objectSerializeFns.ts";
import {
    AimTrainingStatsMsg,
    AimTrainingSettingsMsg,
    AliveCountsMsg,
    ArenaRoundMsg,
    BitStream,
    JoinedMsg,
    InputMsg,
    MapMsg,
    MsgStream,
    MsgType,
    UpdateMsg,
} from "../../shared/net/net.ts";
import { MapDefs } from "../../shared/defs/mapDefs.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { JoinMsg } from "../../shared/net/joinMsg.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { Game } from "./game/game.ts";
import {
    aimTrainingAccuracy,
    aimTrainingCatalog,
    aimTrainingSpeedBonusPercent,
    healthAfterTrainingDamage,
    normalizeAimTrainingSettings,
    useInfiniteTrainingMagazine,
} from "./aimTraining.ts";

async function createNativeTrainingGame(options: {
    id: string;
    weapon: string;
    infiniteMagazine: boolean;
    targetBoost: number;
    distance: number;
}): Promise<void> {
    const sentSockets: string[] = [];
    const sentPackets: Uint8Array[] = [];
    const game = new Game(
        options.id,
        {
            mapName: "aim_training",
            teamMode: TeamMode.Solo,
            privateGame: true,
            aimTrainingWeapon: options.weapon,
            aimTrainingInfiniteMagazine: options.infiniteMagazine,
            aimTrainingTargetBoost: options.targetBoost,
            aimTrainingDistance: options.distance,
        },
        (socketId, data) => {
            sentSockets.push(socketId);
            sentPackets.push(new Uint8Array(data));
        },
        () => {},
    );
    await game.init();

    const targets = game.playerBarn.players.filter((player) => player.internalTrainingTarget);
    assert.equal(targets.length, 1, "the authoritative room must create exactly one native target");
    const target = targets[0];
    assert.equal(target.serverBot, true);
    assert.equal(target.trainingTarget, true);
    assert.equal(target.spectatorOnly, false);
    assert.equal(target.weapons[GameConfig.WeaponSlot.Primary].type, "");
    assert.equal(target.weapons[GameConfig.WeaponSlot.Secondary].type, "");
    assert.equal(target.weapons[GameConfig.WeaponSlot.Throwable].type, "");
    assert.equal(target.weapons[GameConfig.WeaponSlot.Melee].type, "fists");
    assert.equal(target.boost, options.targetBoost);
    assert.equal(game.aiPlayerCount, 1);
    assert.equal(game.serverBotCount, 1);
    assert.equal(game.humanPlayerCount, 0);
    assert.equal(game.started, false, "a native target alone must not start the practice clock");

    game.addJoinToken("human-token", false, 1, 60_000, false, false);
    const humanJoin = new JoinMsg();
    humanJoin.protocol = GameConfig.protocolVersion;
    humanJoin.matchPriv = "human-token";
    humanJoin.name = "Trainer";
    humanJoin.loadout.outfit = "outfitBase";
    humanJoin.loadout.melee = "fists";
    humanJoin.loadout.heal = "heal_basic";
    humanJoin.loadout.boost = "boost_basic";
    const human = game.playerBarn.addPlayer("human-socket", humanJoin);
    assert(human);

    assert.equal(game.started, true, "the human must start the native practice room immediately");
    assert.equal(game.arenaPlayersLocked, false);
    assert.equal(game.modeManager.handleGameEnd(), false, "practice rooms are persistent");
    assert.equal(game.playerBarn.livingPlayers.length, 2);
    assert.equal(game.aliveCount, 2);
    assert.equal(game.humanPlayerCount, 1);
    assert.equal(game.aiPlayerCount, 1);
    assert.equal(human.trainingTarget, false);
    assert.equal(human.spectatorOnly, false);
    assert.equal(human.spectating, undefined);
    assert.equal(human.weapons[GameConfig.WeaponSlot.Primary].type, options.weapon);
    assert.equal(
        human.weapons[GameConfig.WeaponSlot.Secondary].type,
        game.aimTrainingSettings.weapon1,
    );

    // Exercise the same authoritative input path used by a mobile HUD tap.
    // A direct WeaponManager call would miss regressions where InputMsg is
    // ignored because the trainee was accidentally classified as a spectator
    // or the equip input stopped being accepted in the practice range.
    let inputSeq = 1;
    const equipThroughInput = (
        input: number,
        expectedSlot: number,
        expectedWeapon: string,
    ): void => {
        const msg = new InputMsg();
        msg.seq = inputSeq++;
        msg.addInput(input);
        human.handleInput(msg);
        assert.equal(human.curWeapIdx, expectedSlot);
        assert.equal(human.activeWeapon, expectedWeapon);
    };
    equipThroughInput(
        GameConfig.Input.EquipSecondary,
        GameConfig.WeaponSlot.Secondary,
        game.aimTrainingSettings.weapon1,
    );
    equipThroughInput(
        GameConfig.Input.EquipPrimary,
        GameConfig.WeaponSlot.Primary,
        options.weapon,
    );
    assert.equal(Math.round(target.pos.x - human.pos.x), options.distance);
    for (const scope of ["1xscope", "2xscope", "4xscope", "8xscope", "15xscope"]) {
        assert.equal(human.inventory[scope], 1, `the practice range must provide ${scope}`);
    }
    assert.equal(game.gas.stage, 0);
    assert.equal(game.gas.damage, 0);
    assert(game.gas.currentRad > game.map.width, "the practice range gas must remain outside the map");

    const beforeY = target.pos.y;
    for (let i = 0; i < 12; i++) target.update(1 / 30);
    assert.notEqual(target.pos.y, beforeY, "the native target must move without a websocket/smartBot");
    assert.equal(target.health, GameConfig.player.health);
    assert.equal(target.shootStart, false);
    assert.equal(target.shootHold, false);

    const changed = game.applyAimTrainingSettings({
        weapon0: "mk12",
        infiniteMagazine: true,
        targetBoost: 0,
        distance: 100,
        verticalRandomMovement: false,
        omnidirectionalRandomMovement: true,
        dodgeBullets: true,
    }, human);
    assert.equal(changed, true);
    assert.equal(human.weapons[GameConfig.WeaponSlot.Primary].type, "mk12");
    assert.equal(Math.round(target.pos.x - human.pos.x), 100);
    assert.equal(game.aimTrainingSettings.omnidirectionalRandomMovement, true);
    assert.equal(game.aimTrainingSettings.verticalRandomMovement, false);
    assert.equal(game.aimTrainingSettings.dodgeBullets, true);
    assert.equal(target.boost, 0);

    // Statistics remain cumulative across both configured weapon slots and
    // can be explicitly cleared without rebuilding the room.
    game.applyAimTrainingSettings({
        ...game.aimTrainingSettings,
        weapon0: "m4a1",
        weapon1: "mk12",
        throwable: "frag",
        helmetLevel: 0,
        chestLevel: 0,
    }, human);
    human.resetTrainingStats();
    const primaryShot = human.recordTrainingShot("m4a1");
    assert(primaryShot);
    target.damage({
        amount: 20,
        damageType: GameConfig.DamageType.Player,
        dir: v2.create(1, 0),
        gameSourceType: "m4a1",
        source: human,
        trainingShot: primaryShot,
    });
    equipThroughInput(
        GameConfig.Input.EquipSecondary,
        GameConfig.WeaponSlot.Secondary,
        "mk12",
    );
    const secondaryShot = human.recordTrainingShot("mk12");
    assert(secondaryShot);
    target.damage({
        amount: 35,
        damageType: GameConfig.DamageType.Player,
        dir: v2.create(1, 0),
        gameSourceType: "mk12",
        source: human,
        trainingShot: secondaryShot,
    });
    // A delayed secondary effect from the first gun keeps contributing damage,
    // but cannot turn one already-hit projectile into a second hit after the
    // player has switched weapons.
    target.damage({
        amount: 5,
        damageType: GameConfig.DamageType.Player,
        dir: v2.create(1, 0),
        gameSourceType: "m4a1",
        source: human,
        trainingShot: primaryShot,
        isExplosion: true,
    });
    assert.equal(human.trainingShotsFired, 2);
    assert.equal(human.trainingHits, 2);
    assert(human.trainingDamageDealt > 55, "all damage from both guns must update the total");
    game.applyAimTrainingSettings({ ...game.aimTrainingSettings, resetStats: true }, human);
    assert.equal(human.trainingShotsFired, 0);
    assert.equal(human.trainingHits, 0);
    assert.equal(human.trainingDamageDealt, 0);
    // Clearing stats starts a new epoch: an old slow projectile landing after
    // the reset must not create a hit without a matching shot denominator.
    target.damage({
        amount: 15,
        damageType: GameConfig.DamageType.Player,
        dir: v2.create(1, 0),
        gameSourceType: "mk12",
        source: human,
        trainingShot: secondaryShot,
    });
    assert.equal(human.trainingHits, 0);
    assert.equal(human.trainingDamageDealt, 0);

    const humanHealth = human.health;
    human.damage({
        amount: 999,
        damageType: GameConfig.DamageType.Player,
        dir: v2.create(-1, 0),
        gameSourceType: "frag",
        source: target,
        isExplosion: true,
    });
    assert.equal(human.health, humanHealth, "the human trainee must be invincible");

    game.applyAimTrainingSettings({
        ...game.aimTrainingSettings,
        normalHealth: true,
        helmetLevel: 2,
        chestLevel: 3,
        targetBoost: 69,
    }, human);
    assert.equal(target.helmet, "helmet02");
    assert.equal(target.chest, "chest03");
    target.damage({
        amount: 9999,
        damageType: GameConfig.DamageType.Player,
        dir: v2.create(1, 0),
        gameSourceType: "m4a1",
        source: human,
    });
    assert.equal(target.dead, true, "normal-health target must be able to die");
    target.update(2);
    assert.equal(target.dead, false, "dead training target must automatically respawn");
    assert.equal(target.health, GameConfig.player.health);
    assert.equal(target.boost, 69, "training boost must be restored and locked after respawn");

    for (const movement of [
        { verticalRandomMovement: false, omnidirectionalRandomMovement: false, name: "静止" },
        { verticalRandomMovement: true, omnidirectionalRandomMovement: false, name: "上下随机" },
        { verticalRandomMovement: false, omnidirectionalRandomMovement: true, name: "全向随机" },
    ]) {
        for (const bullet of game.bulletBarn.bullets) bullet.alive = false;
        game.applyAimTrainingSettings({
            ...game.aimTrainingSettings,
            distance: 30,
            dodgeBullets: true,
            verticalRandomMovement: movement.verticalRandomMovement,
            omnidirectionalRandomMovement: movement.omnidirectionalRandomMovement,
        }, human);
        human.dir = v2.normalize(v2.sub(target.pos, human.pos));
        human.toMouseLen = 30;
        human.weaponManager.fireWeapon(false);
        assert(game.bulletBarn.bullets.some((bullet) => bullet.alive));
        target.update(1 / 30);
        assert(
            target.moveUp || target.moveDown,
            `${movement.name}模式不能阻止AI对来弹进行独立侧闪`,
        );
    }

    // Dedicated rifle-stream dodge: the target commits to one lateral side
    // instead of flipping direction for every new bullet (the old per-bullet
    // recompute flipped at the rifle fire rate and the target twitched in
    // place while being hit continuously).
    {
        for (const bullet of game.bulletBarn.bullets) bullet.alive = false;
        game.applyAimTrainingSettings({
            ...game.aimTrainingSettings,
            distance: 40,
            dodgeBullets: true,
            normalHealth: false,
            verticalRandomMovement: false,
            omnidirectionalRandomMovement: false,
        }, human);
        if (target.dead) target.update(2);
        const targetPos = v2.copy(target.pos);
        const bulletDir = v2.normalize(v2.sub(targetPos, human.pos));
        const placeBullet = (distanceAhead: number, fromPos = targetPos) => {
            const bullet = {
                alive: true,
                playerId: human.__id,
                layer: target.layer,
                pos: v2.sub(fromPos, v2.mul(bulletDir, distanceAhead)),
                dir: v2.copy(bulletDir),
                speed: 300,
            };
            game.bulletBarn.bullets.push(bullet as never);
            return bullet;
        };
        const first = placeBullet(30);
        target.update(1 / 30);
        assert(
            target.moveUp || target.moveDown,
            "a rifle bullet ahead must trigger a lateral dodge",
        );
        let flips = 0;
        let prevUp = target.moveUp;
        for (let i = 0; i < 10; i++) {
            // Fresh rifle shot every 0.05s, like an automatic rifle stream.
            first.alive = false;
            placeBullet(30);
            target.update(1 / 30);
            const up = target.moveUp;
            if (up !== prevUp) flips++;
            prevUp = up;
        }
        assert.ok(
            flips <= 2,
            `sustained rifle fire must not flip the dodge every tick, flips=${flips}`,
        );
        // Even an unavoidable bullet (0.02s to impact) keeps the target moving
        // so the trainee never shoots a frozen target.
        first.alive = false;
        // An unavoidable bullet (0.02s to impact) aimed at the target's current
        // position must still force the target to keep moving.
        placeBullet(6, v2.copy(target.pos));
        target.update(1 / 30);
        assert(
            target.moveUp || target.moveDown || target.moveLeft || target.moveRight,
            "an unavoidable bullet must still force the target to move",
        );
        for (const bullet of game.bulletBarn.bullets) bullet.alive = false;
    }

    for (const bullet of game.bulletBarn.bullets) bullet.alive = false;
    const returnAnchor = v2.create(human.pos.x + 30, human.pos.y);
    target.pos.x = returnAnchor.x + 18;
    target.pos.y = returnAnchor.y + 18;
    target.posOld = v2.copy(target.pos);
    game.grid.updateObject(target);
    const displacedDistance = v2.distance(target.pos, returnAnchor);
    target.update(0.7);
    assert(
        target.moveLeft && target.moveDown,
        "after fire stops, a displaced dodge target must walk toward the configured range anchor",
    );
    for (let i = 0; i < 24; i++) target.update(1 / 30);
    assert(
        v2.distance(target.pos, returnAnchor) < displacedDistance,
        "idle return movement must reduce accumulated dodge displacement",
    );

    // Network synchronization must only write to the real human socket. The
    // internal target participates in replication but never receives packets.
    game.netSync();
    assert(sentSockets.length > 0, "the human must receive the initial room state");
    assert(sentSockets.every((socketId) => socketId === "human-socket"));

    const updates: UpdateMsg[] = [];
    for (const packet of sentPackets) {
        const packetStream = new MsgStream(packet);
        while (packetStream.stream.byteIndex < packet.byteLength) {
            const type = packetStream.deserializeMsgType();
            switch (type) {
                case MsgType.Joined:
                    new JoinedMsg().deserialize(packetStream.stream);
                    break;
                case MsgType.Map:
                    new MapMsg().deserialize(packetStream.stream);
                    break;
                case MsgType.AliveCounts:
                    new AliveCountsMsg().deserialize(packetStream.stream);
                    break;
                case MsgType.ArenaRound:
                    new ArenaRoundMsg().deserialize(packetStream.stream);
                    break;
                case MsgType.AimTrainingStats:
                    new AimTrainingStatsMsg().deserialize(packetStream.stream);
                    break;
                case MsgType.Update: {
                    const update = new UpdateMsg();
                    update.deserialize(packetStream.stream, {
                        getTypeById: () => ObjectType.Player,
                    });
                    updates.push(update);
                    break;
                }
                default:
                    assert.fail(`unexpected initial aim-training message type ${type}`);
            }
        }
    }
    assert.equal(updates.length, 1, "the initial room sync must contain one update");
    const fullPlayerIds = updates[0].fullObjects
        .filter((object) => object.__type === ObjectType.Player)
        .map((object) => object.__id);
    assert(
        fullPlayerIds.includes(human.__id),
        "the first browser update must create the local human before partial updates",
    );
    assert(
        fullPlayerIds.includes(target.__id),
        "the first browser update must create the internal target before partial updates",
    );

    // The browser initializes its renderer after the separate Joined packet.
    // Keep a short redundant full snapshot window so a delayed first renderer
    // frame can still recover instead of trying to apply partial player data to
    // an empty object pool.
    game.netSync();
    const retryUpdates: UpdateMsg[] = [];
    for (const packet of sentPackets.slice(2)) {
        const packetStream = new MsgStream(packet);
        while (packetStream.stream.byteIndex < packet.byteLength) {
            const type = packetStream.deserializeMsgType();
            if (type === MsgType.Update) {
                const update = new UpdateMsg();
                update.deserialize(packetStream.stream, {
                    getTypeById: () => ObjectType.Player,
                });
                retryUpdates.push(update);
            } else if (type === MsgType.AliveCounts) {
                new AliveCountsMsg().deserialize(packetStream.stream);
            } else if (type === MsgType.AimTrainingStats) {
                new AimTrainingStatsMsg().deserialize(packetStream.stream);
            } else if (type === MsgType.ArenaRound) {
                new ArenaRoundMsg().deserialize(packetStream.stream);
            } else {
                assert.fail(`unexpected retry aim-training message type ${type}`);
            }
        }
    }
    assert.equal(retryUpdates.length, 1, "the retry room sync must contain one update");
    const retryFullPlayerIds = retryUpdates[0].fullObjects
        .filter((object) => object.__type === ObjectType.Player)
        .map((object) => object.__id);
    assert(
        retryFullPlayerIds.includes(human.__id) &&
            retryFullPlayerIds.includes(target.__id),
        "the retry browser update must remain a complete recoverable player snapshot",
    );

    game.stop();
}

const defaults = normalizeAimTrainingSettings({});
assert.equal(defaults.weapon0, "m4a1");
assert.equal(defaults.weapon1, "mk12");
assert.equal(defaults.throwable, "frag");
assert.equal(defaults.targetBoost, 38);
assert.equal(defaults.distance, 60);
assert.equal(defaults.infiniteMagazine, false);
assert.equal(defaults.verticalRandomMovement, true);
assert.equal(defaults.omnidirectionalRandomMovement, false);
assert.equal(defaults.dodgeBullets, false);

const normalized = normalizeAimTrainingSettings({
    weapon0: "ak47",
    targetBoost: 100,
    distance: 999,
    infiniteMagazine: true,
    verticalRandomMovement: false,
    omnidirectionalRandomMovement: true,
    dodgeBullets: true,
});
assert.equal(normalized.weapon0, "ak47");
assert.equal(normalized.targetBoost, 100);
assert.equal(normalized.distance, 160);
assert.equal(normalized.infiniteMagazine, true);
assert.equal(normalized.verticalRandomMovement, false);
assert.equal(normalized.omnidirectionalRandomMovement, true);
assert.equal(normalized.dodgeBullets, true);

const catalog = aimTrainingCatalog();
assert.ok(catalog.weapons.length > 20, "training catalog should expose normal guns");
assert.deepEqual(catalog.boostLevels.map((entry) => entry.level), [0, 12, 38, 69, 100]);
assert.equal(aimTrainingSpeedBonusPercent(38), 0);
assert.ok(Math.abs(aimTrainingSpeedBonusPercent(69) - 15.4166666667) < 0.001);
assert.equal(aimTrainingAccuracy(0, 0), 0);
assert.equal(aimTrainingAccuracy(500, 320), 64);

assert.equal(useInfiniteTrainingMagazine("aim_training", false, true), true);
assert.equal(useInfiniteTrainingMagazine("aim_training", true, true), false);
assert.equal(useInfiniteTrainingMagazine("main", false, true), false);
assert.equal(healthAfterTrainingDamage(true, 100, 10000), 100);
assert.equal(healthAfterTrainingDamage(false, 100, 35), 65);

const map = MapDefs.aim_training;
assert.equal(map.gameMode.maxPlayers, 2);
assert.equal(map.arena?.lockPlayersUntilFull, false);
assert.equal(map.arena?.loot.length, 0);
assert.ok(map.arena?.startingLoadout.perks?.includes("endless_ammo"));
assert.deepEqual(
    ["1xscope", "2xscope", "4xscope", "8xscope", "15xscope"].map(
        (scope) => map.arena?.startingLoadout.inventory?.[scope],
    ),
    [1, 1, 1, 1, 1],
);

const outgoing = new AimTrainingStatsMsg();
outgoing.shotsFired = 1234;
outgoing.hits = 789;
outgoing.damageDealt = 4567.8;
outgoing.distance = 120;
outgoing.targetBoost = 75;
outgoing.speedBonus = aimTrainingSpeedBonusPercent(75);
outgoing.infiniteMagazine = true;
outgoing.targetReady = true;
outgoing.weapon0 = "mk12";
outgoing.weapon1 = "sv98";
outgoing.throwable = "frag";
outgoing.verticalRandomMovement = false;
outgoing.omnidirectionalRandomMovement = true;
outgoing.dodgeBullets = true;
const write = new BitStream(new ArrayBuffer(64));
outgoing.serialize(write);
const incoming = new AimTrainingStatsMsg();
incoming.deserialize(new BitStream(write.buffer));
assert.equal(incoming.shotsFired, outgoing.shotsFired);
assert.equal(incoming.hits, outgoing.hits);
assert.equal(incoming.damageDealt, outgoing.damageDealt);
assert.equal(incoming.distance, outgoing.distance);
assert.equal(incoming.targetBoost, outgoing.targetBoost);
assert.ok(Math.abs(incoming.speedBonus - outgoing.speedBonus) < 0.01);
assert.equal(incoming.infiniteMagazine, true);
assert.equal(incoming.targetReady, true);
assert.equal(incoming.weapon0, "mk12");
assert.equal(incoming.weapon1, "sv98");
assert.equal(incoming.throwable, "frag");
assert.equal(incoming.verticalRandomMovement, false);
assert.equal(incoming.omnidirectionalRandomMovement, true);
assert.equal(incoming.dodgeBullets, true);
assert.ok(Number.isInteger(MsgType.AimTrainingStats));

const outgoingSettings = new AimTrainingSettingsMsg();
outgoingSettings.weapon0 = "sv98";
outgoingSettings.weapon1 = "m4a1";
outgoingSettings.throwable = "frag";
outgoingSettings.infiniteMagazine = true;
outgoingSettings.targetBoost = 100;
outgoingSettings.distance = 140;
outgoingSettings.verticalRandomMovement = false;
outgoingSettings.omnidirectionalRandomMovement = true;
outgoingSettings.dodgeBullets = true;
const settingsWrite = new BitStream(new ArrayBuffer(32));
outgoingSettings.serialize(settingsWrite);
assert.equal(settingsWrite.index % 8, 0, "settings messages must remain byte-aligned");
const incomingSettings = new AimTrainingSettingsMsg();
incomingSettings.deserialize(new BitStream(settingsWrite.buffer));
assert.deepEqual(incomingSettings, outgoingSettings);
assert.ok(Number.isInteger(MsgType.AimTrainingSettings));

Promise.all([
    createNativeTrainingGame({
        id: "aim-training-native-ak",
        weapon: "ak47",
        infiniteMagazine: true,
        targetBoost: 69,
        distance: 60,
    }),
    createNativeTrainingGame({
        id: "aim-training-native-mosin",
        weapon: "mosin",
        infiniteMagazine: false,
        targetBoost: 38,
        distance: 80,
    }),
]).then(() => console.log("aim training native-room smoke test passed"));
