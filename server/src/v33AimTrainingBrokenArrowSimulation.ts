import assert from "assert/strict";
import { GameConfig } from "../../shared/gameConfig.ts";
import {
    aimTrainingHumanReady,
    aimTrainingTargetReady,
    waitForAimTrainingHuman,
} from "./aimTraining.ts";
import {
    airstrikePointRisk,
    assessAirstrikeThreat,
    mergeAirstrikeZoneUpdates,
    selectAirstrikeEscapeTarget,
    type AirstrikeZoneState,
} from "./bot/airstrikeEvasion.ts";
import { planForbiddenCounterStrobes } from "./bot/forbiddenCombat.ts";
import {
    getStrobeAirstrikeIntervalMs,
    getStrobeAirstrikeOffsets,
    predictStrobeAirstrikeWarning,
} from "./game/objects/projectile.ts";
import { throwableThrowAnimationDuration } from "./game/weaponManager.ts";
import { GameServer } from "./gameServer.ts";

async function main(): Promise<void> {
const t0 = 100_000;
assert.equal(aimTrainingHumanReady({ humanPlayerCount: 1, aiPlayerCount: 0, serverBotCount: 0 }), true);
assert.equal(aimTrainingHumanReady({ humanPlayerCount: 0, aiPlayerCount: 1, serverBotCount: 1 }), false);
assert.equal(aimTrainingTargetReady({ humanPlayerCount: 1, aiPlayerCount: 1, serverBotCount: 1 }), true);

let polls = 0;
assert.equal(
    await waitForAimTrainingHuman(
        () => ({
            humanPlayerCount: ++polls >= 3 ? 1 : 0,
            aiPlayerCount: 0,
            serverBotCount: 0,
        }),
        100,
        1,
    ),
    true,
);
assert.ok(polls >= 3);

const server = Object.create(GameServer.prototype) as GameServer;
(server as any).region = { https: false, address: "127.0.0.1" };
(server as any).logger = { warn: () => {}, log: () => {} };
let room = {
    id: "aim-v33-order", mapName: "aim_training", teamMode: 1, canJoin: true,
    aliveCount: 1, connectedCount: 1, humanPlayerCount: 0, aiPlayerCount: 1,
    spectatorCount: 0, serverBotCount: 1, serverBotTeamCounts: [],
    reservedHumanCount: 1, startedTime: 0, stopped: false, privateGame: true,
};
let spawnCalls = 0;
(server as any).manager = {
    createGame: async () => room,
    createJoinToken: async (gameId: string) => ({ gameId, data: "human-token" }),
    getById: () => room,
    stopGame: () => { room.stopped = true; return true; },
};
(server as any).spawnGameBot = () => { spawnCalls += 1; };
const match = await (server as any).createAimTrainingMatch({
    weapon: "m4a1", infiniteMagazine: true, targetBoost: 50, distance: 60,
});
assert.equal(match.matchData.data, "human-token");
assert.equal(spawnCalls, 0, "V45 target must be created inside the room process, not as a smartBot child");
room = { ...room, humanPlayerCount: 1, connectedCount: 2, aliveCount: 2, reservedHumanCount: 0 };
await new Promise<void>((resolve) => setTimeout(resolve, 20));
assert.equal(spawnCalls, 0, "internal target must never launch an external target process");
assert.equal(room.serverBotCount, 1);

const initial: AirstrikeZoneState = {
    pos: { x: 50, y: 50 },
    rad: 34,
    highDamageRad: 25,
    impactInMs: 2400,
    expiresAt: t0 + 6200,
    updatedAt: t0,
};
const retained = mergeAirstrikeZoneUpdates([initial], [], t0 + 700);
assert.equal(retained.length, 1, "strobe-to-plane hand-off gap must retain the warning");
assert.equal(retained[0].impactInMs, 1700);
assert.equal(mergeAirstrikeZoneUpdates(retained, [], t0 + 6300).length, 0);

const zones: AirstrikeZoneState[] = [
    { ...initial, pos: { x: 50, y: 50 } },
    { ...initial, pos: { x: 78, y: 50 }, rad: 30, highDamageRad: 22 },
];
const threat = assessAirstrikeThreat({ x: 50, y: 50 }, zones, t0);
assert(threat?.highestPriority);
const escape = selectAirstrikeEscapeTarget({
    origin: { x: 50, y: 50 },
    zone: threat!,
    bounds: { minX: 1, minY: 1, maxX: 160, maxY: 120 },
    pathClear: () => true,
    airstrikeRisk: (point) => airstrikePointRisk(point, zones, t0),
    playerSeed: 7,
});
assert.ok(airstrikePointRisk(escape.target, zones, t0) < 10_000, "escape point must avoid overlapping strike zones");
assert.ok(Math.hypot(escape.target.x - 50, escape.target.y - 50) > 45);

assert.deepEqual(getStrobeAirstrikeOffsets(true), [0, 5, -5, 10, -10]);
assert.equal(getStrobeAirstrikeIntervalMs(true), 600);
assert.equal(getStrobeAirstrikeIntervalMs(false), 1000);
assert.equal(throwableThrowAnimationDuration("strobe"), GameConfig.player.throwTime);
assert.equal(throwableThrowAnimationDuration("frag"), GameConfig.player.throwTime);
const opening = planForbiddenCounterStrobes(4, 3);
assert.equal(opening.barrageCount, 4);
assert.equal(opening.reserveCount, 0);

const warning = predictStrobeAirstrikeWarning(
    {
        pos: { x: 25, y: 30 },
        vel: { x: 28, y: 0 },
        posZ: 0.5,
        velZ: 5,
        createdAtMs: t0,
    },
    true,
    176,
    136,
    t0,
);
assert(warning);
assert.equal(warning.rad, 34);
assert.equal(warning.highDamageRad, 25);
assert.ok(warning.duration > 6, "warning must cover every accelerated Broken Arrow pass");

console.log(JSON.stringify({
    aimTraining: {
        joinOrderIndependent: true,
        targetReadySignal: true,
        readinessPolls: polls,
        internalTargetExternalSpawnCalls: spawnCalls,
    },
    brokenArrow: {
        lanes: getStrobeAirstrikeOffsets(true).length,
        laneIntervalMs: getStrobeAirstrikeIntervalMs(true),
        throwAnimationSeconds: throwableThrowAnimationDuration("strobe"),
        warningRadius: warning.rad,
        highDamageRadius: warning.highDamageRad,
        counterBarrage: opening.barrageCount,
    },
    evasion: {
        warningRetainedAcrossGap: retained.length === 1,
        retainedImpactMs: retained[0].impactInMs,
        overlapRiskAtEscape: airstrikePointRisk(escape.target, zones, t0),
        escapeTarget: escape.target,
    },
}, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
