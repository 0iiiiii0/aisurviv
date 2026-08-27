import assert from "assert/strict";
import fs from "fs";
import path from "path";
import { TeamMode } from "../../shared/gameConfig.ts";
import { ObjectType } from "../../shared/net/objectSerializeFns.ts";
import { Config } from "./config.ts";
import {
    chooseForbiddenIndirectShot,
    estimateForbiddenTargetVelocity,
    evaluateForbiddenRicochetCandidate,
    findForbiddenExposedAimPoint,
    solveInterceptWithSpeedRecovery,
    type ForbiddenObstacleSnapshot,
} from "./bot/forbiddenCombat.ts";
import { shouldAutoFillRoom } from "./botAutoFill.ts";
import { snapshotLocalBallisticObstacle } from "./bot/smartBotSupport.ts";
import {
    DuelLobbyService,
    type DuelLobbyLoadout,
    type DuelLobbyMatchRequest,
} from "./duelLobby.ts";
import type { GameData } from "./game/gameManager.ts";

const length = (value: { x: number; y: number }): number => Math.hypot(value.x, value.y);
const sub = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: a.x - b.x,
    y: a.y - b.y,
});
const add = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: a.x + b.x,
    y: a.y + b.y,
});
const mul = (a: { x: number; y: number }, scalar: number) => ({
    x: a.x * scalar,
    y: a.y * scalar,
});

const recoveredPosition = (
    start: { x: number; y: number },
    slowed: { x: number; y: number },
    recovered: { x: number; y: number },
    slowdown: number,
    time: number,
) => add(
    start,
    add(
        mul(slowed, Math.min(slowdown, time)),
        mul(recovered, Math.max(0, time - slowdown)),
    ),
);

// Deterministic broad coverage for direct ballistics. This includes lateral,
// diagonal and approaching/receding targets plus piecewise speed recovery.
let randomState = 0x43c0ffee;
const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 0x1_0000_0000;
};
let worstDirectMiss = 0;
for (let index = 0; index < 1400; index++) {
    const randomVec = (scale: number) => ({
        x: (random() * 2 - 1) * scale,
        y: (random() * 2 - 1) * scale,
    });
    const randomShooter = randomVec(30);
    const randomTarget = add(randomShooter, {
        x: 12 + random() * 110,
        y: (random() * 2 - 1) * 65,
    });
    const slowed = randomVec(9);
    const recovered = randomVec(18);
    const slowdown = random() * 0.55;
    const speed = 55 + random() * 150;
    const solution = solveInterceptWithSpeedRecovery({
        shooterPos: randomShooter,
        targetPos: randomTarget,
        slowedVelocity: slowed,
        recoveredVelocity: recovered,
        slowdownRemaining: slowdown,
        projectileSpeed: speed,
        maxTime: 3.2,
    });
    if (!solution.exact) continue;
    const expectedTarget = recoveredPosition(
        randomTarget,
        slowed,
        recovered,
        slowdown,
        solution.time,
    );
    const direction = mul(
        sub(solution.aimPoint, randomShooter),
        1 / Math.max(1e-9, length(sub(solution.aimPoint, randomShooter))),
    );
    const bullet = add(randomShooter, mul(direction, speed * solution.time));
    const miss = length(sub(bullet, expectedTarget));
    worstDirectMiss = Math.max(worstDirectMiss, miss);
    assert(miss <= 1e-5, `analytic direct intercept miss ${miss} in case ${index}`);
}

// V42 received Forbidden contexts every ~6 ms while positions advanced on a
// slower game tick. A duplicate position sample must not erase authoritative
// straight-line velocity.
const preservedVelocity = estimateForbiddenTargetVelocity({
    currentPos: { x: 40, y: 20 },
    authoritativeVelocity: { x: 0, y: 14.5 },
    previousPos: { x: 40, y: 20 },
    previousVelocity: { x: 0, y: 14.5 },
    deltaSeconds: 0.006,
});
assert(
    preservedVelocity.y >= 13.5,
    `high-frequency duplicate snapshots must preserve authoritative speed, got ${preservedVelocity.y}`,
);

// Reproduce the user's simplest failure case: a fully visible target crossing
// directly in front of LEGIT at constant speed. The exposed-body sampler must
// be centred on the intercept, not on the stale current target position.
const shooter = { x: 0, y: 0 };
const target = { x: 46, y: 0 };
const targetVelocity = { x: 0, y: 14.5 };
const projectileSpeed = 106; // Groza family speed in the uploaded duel logs.
const intercept = solveInterceptWithSpeedRecovery({
    shooterPos: shooter,
    targetPos: target,
    slowedVelocity: targetVelocity,
    recoveredVelocity: targetVelocity,
    slowdownRemaining: 0,
    projectileSpeed,
    maxTime: 2.8,
});
const exposed = findForbiddenExposedAimPoint({
    shooterPos: shooter,
    targetPos: intercept.aimPoint,
    targetRadius: 1,
    layer: 0,
    obstacles: [],
    preferredDirection: targetVelocity,
});
assert(exposed, "a fully visible predicted target body must produce an aim point");
const bulletArrival = add(shooter, mul({
    x: exposed!.point.x / length(exposed!.point),
    y: exposed!.point.y / length(exposed!.point),
}, projectileSpeed * intercept.time));
const targetArrival = add(target, mul(targetVelocity, intercept.time));
assert(
    length(sub(bulletArrival, targetArrival)) <= 0.08,
    "constant-speed direct intercept must meet the target instead of under-leading it",
);

const reflector: ForbiddenObstacleSnapshot = {
    id: 43,
    type: "stone_01",
    pos: { x: 10, y: 10.5 },
    layer: 0,
    height: 2,
    health: 100,
    maxHealth: 100,
    healthT: 1,
    dead: false,
    collidable: true,
    destructible: false,
    armorPlated: false,
    stonePlated: false,
    reflectBullets: true,
    explosionType: "",
    explosionRadius: 0,
    collider: {
        type: 1,
        min: { x: 8, y: 10 },
        max: { x: 12, y: 11 },
    },
};

const realBarrel = snapshotLocalBallisticObstacle({
    __id: 44,
    __type: ObjectType.Obstacle,
    data: { type: "barrel_01", pos: { x: 10, y: 10 }, layer: 0, scale: 1 },
});
assert(realBarrel, "barrel_01 must produce a ballistic obstacle snapshot");
assert.equal(realBarrel!.reflectBullets, true, "oil barrels are authoritative reflectors");
assert.equal(realBarrel!.collider.type, 0, "oil barrels must retain their circular collider");
assert.equal(
    realBarrel!.collider.type === 0 ? realBarrel!.collider.rad : 0,
    1.75,
    "oil-barrel ricochet planning must use the server's exact 1.75 radius",
);

const fakeMetalReflector = snapshotLocalBallisticObstacle({
    __id: 45,
    __type: ObjectType.Obstacle,
    data: { type: "metal_wall_ext_8", pos: { x: 10, y: 10 }, layer: 0, scale: 1 },
});
assert(fakeMetalReflector, "metal_wall_ext_8 must produce a ballistic obstacle snapshot");
assert.equal(
    fakeMetalReflector!.reflectBullets,
    true,
    "the final merged metal material definition must match the server reflection rule",
);
assert.equal(
    fakeMetalReflector!.collider.type,
    1,
    "a long metal wall must be planned as its real AABB instead of a guessed circle",
);
if (fakeMetalReflector!.collider.type === 1) {
    assert.deepEqual(fakeMetalReflector!.collider.min, { x: 9.5, y: 6 });
    assert.deepEqual(fakeMetalReflector!.collider.max, { x: 10.5, y: 14 });
}

const barrelRicochet = chooseForbiddenIndirectShot({
    from: { x: 0, y: 0 },
    enemyPos: { x: 20, y: 0 },
    enemyVelocity: { x: 0, y: 0 },
    bulletSpeed: 100,
    bulletRange: 100,
    bulletDamage: 30,
    obstacleDamage: 1,
    armorPiercing: false,
    stonePiercing: false,
    canRicochet: true,
    layer: 0,
    obstacles: [realBarrel!],
    targetRadius: 1,
    spreadRadians: 0,
    barrelLength: 1,
    reflectDistanceDecay: 1.5,
});
assert.equal(barrelRicochet?.kind, "ricochet");
assert(
    (barrelRicochet?.missDistance ?? Infinity) <= 0.02,
    "an exact oil-barrel bank shot must intersect the target collider",
);
assert(
    Math.abs(length(sub(barrelRicochet!.aimPoint, { x: 10, y: 10 })) - 1.75) <= 0.02,
    "the selected oil-barrel aim point must stay on its real circular surface",
);
const ricochet = chooseForbiddenIndirectShot({
    from: { x: 0, y: 0 },
    enemyPos: { x: 20, y: 0 },
    enemyVelocity: { x: 0, y: 3.2 },
    bulletSpeed: 35,
    bulletRange: 90,
    bulletDamage: 55,
    obstacleDamage: 1,
    armorPiercing: false,
    stonePiercing: false,
    canRicochet: true,
    layer: 0,
    obstacles: [reflector],
    targetRadius: 1,
    spreadRadians: 0,
});
assert.equal(ricochet?.kind, "ricochet");
assert(
    (ricochet?.missDistance ?? Infinity) <= 0.08,
    "selected ricochet must be geometrically validated against the moving target collider",
);
assert(ricochet?.predictedTargetPoint, "ricochet must expose its predicted target point for diagnostics");

const exactCandidate = evaluateForbiddenRicochetCandidate({
    from: { x: 0, y: 0 },
    surfacePoint: { x: 10, y: 10 },
    surfaceNormal: { x: 0, y: -1 },
    enemyPos: { x: 20, y: 0 },
    enemyVelocity: { x: 0, y: 0 },
    bulletSpeed: 100,
    bulletRange: 100,
    targetRadius: 1,
});
assert(exactCandidate && exactCandidate.missDistance < 1e-6);

let worstRicochetMiss = 0;
for (let index = 0; index < 240; index++) {
    const from = { x: -3 + random() * 4, y: -5 + random() * 3 };
    const surfacePoint = { x: 7 + random() * 6, y: 8 + random() * 5 };
    const surfaceNormal = { x: 0, y: -1 };
    const speed = 80 + random() * 120;
    const barrelLength = random() * 2.2;
    const incomingDirection = (() => {
        const raw = sub(surfacePoint, from);
        return mul(raw, 1 / length(raw));
    })();
    const incidence = incomingDirection.y * -1;
    if (incidence >= -0.12) continue;
    const reflectedDirection = {
        x: incomingDirection.x,
        y: -incomingDirection.y,
    };
    const muzzle = add(from, mul(incomingDirection, barrelLength));
    const incomingTime = length(sub(surfacePoint, muzzle)) / speed;
    const outgoingTime = 0.08 + random() * 0.34;
    const bulletPoint = add(surfacePoint, mul(reflectedDirection, speed * outgoingTime));
    const enemyVelocity = {
        x: (random() * 2 - 1) * 9,
        y: (random() * 2 - 1) * 9,
    };
    const flightTime = incomingTime + outgoingTime;
    const enemyPos = sub(bulletPoint, mul(enemyVelocity, flightTime));
    const candidate = evaluateForbiddenRicochetCandidate({
        from,
        surfacePoint,
        surfaceNormal,
        enemyPos,
        enemyVelocity,
        bulletSpeed: speed,
        bulletRange: 180,
        targetRadius: 1,
        barrelLength,
        reflectDistanceDecay: 1.5,
    });
    assert(candidate, `exact constructed ricochet rejected in case ${index}`);
    worstRicochetMiss = Math.max(worstRicochetMiss, candidate!.missDistance);
    assert(candidate!.missDistance <= 1e-5);
}

// Reflected bullets get their own range divided by reflectDistDecay. A route
// beyond that outgoing range must be rejected even when total geometry aligns.
const expirySurface = { x: 10, y: 10 };
const expiryFrom = { x: 0, y: 0 };
const expiryIncoming = mul(
    sub(expirySurface, expiryFrom),
    1 / length(sub(expirySurface, expiryFrom)),
);
const expiryReflected = { x: expiryIncoming.x, y: -expiryIncoming.y };
const expirySpeed = 100;
const expiryOutgoingTime = 0.78;
const expiryBulletPoint = add(
    expirySurface,
    mul(expiryReflected, expirySpeed * expiryOutgoingTime),
);
assert.equal(evaluateForbiddenRicochetCandidate({
    from: expiryFrom,
    surfacePoint: expirySurface,
    surfaceNormal: { x: 0, y: -1 },
    enemyPos: expiryBulletPoint,
    enemyVelocity: { x: 0, y: 0 },
    bulletSpeed: expirySpeed,
    bulletRange: 100,
    targetRadius: 1,
    reflectDistanceDecay: 1.5,
}), null, "a reflected bullet must not plan past its decayed outgoing range");

// The public room created during server startup must remain empty until a human
// joins or obtains a reservation. Explicit AI duels have their own path.
const oldRequireHuman = Config.botAutoFill.requireHumanBeforeFill;
const oldEnabled = Config.botAutoFill.enabled;
Config.botAutoFill.enabled = true;
Config.botAutoFill.requireHumanBeforeFill = true;
assert.equal(shouldAutoFillRoom({
    stopped: false,
    privateGame: false,
    alreadyCompleted: false,
    humanPlayerCount: 0,
    reservedHumanCount: 0,
}), false);
assert.equal(shouldAutoFillRoom({
    stopped: false,
    privateGame: false,
    alreadyCompleted: false,
    humanPlayerCount: 0,
    reservedHumanCount: 1,
}), true);
assert.equal(shouldAutoFillRoom({
    stopped: false,
    privateGame: false,
    alreadyCompleted: false,
    humanPlayerCount: 1,
    reservedHumanCount: 0,
}), true);
Config.botAutoFill.requireHumanBeforeFill = oldRequireHuman;
Config.botAutoFill.enabled = oldEnabled;

async function testLobbyTransactionsAndAiMirror(): Promise<void> {
    const games = new Map<string, GameData>();
    let request: DuelLobbyMatchRequest | null = null;
    const service = new DuelLobbyService(
        async (value) => {
            request = value;
            const gameId = "v43-ai-mirror";
            games.set(gameId, {
                id: gameId,
                teamMode: TeamMode.Solo,
                mapName: "duel",
                canJoin: true,
                aliveCount: 0,
                connectedCount: 0,
                humanPlayerCount: 0,
                aiPlayerCount: 0,
                spectatorCount: 0,
                serverBotCount: 0,
                serverBotTeamCounts: [],
                reservedHumanCount: 0,
                startedTime: 0,
                stopped: false,
                privateGame: true,
            });
            return {
                gameId,
                matches: [{
                    zone: "",
                    gameId,
                    useHttps: false,
                    hosts: ["127.0.0.1:8001"],
                    addrs: ["127.0.0.1:8001"],
                    data: "host-token",
                }],
            };
        },
        (gameId) => games.get(gameId),
    );
    const created = service.create("Host");
    const revision0 = created.lobby.revision;
    const armed = service.updateWeapons(created.lobby.code, created.memberToken, ["mosin", "mp220"]);
    assert(armed.lobby.revision > revision0, "every mutation must advance a monotonic revision");

    const maliciousAsymmetric: DuelLobbyLoadout = {
        ...armed.lobby.loadout,
        weapons: ["ak47", "m39"],
        weaponSelectionMode: "exclusive",
        aiEnabled: true,
        aiDifficulty: "legit",
    };
    const mirrored = service.updateLoadout(
        created.lobby.code,
        created.memberToken,
        maliciousAsymmetric,
    );
    assert.equal(mirrored.lobby.loadout.weaponSelectionMode, "mirrored");
    assert.deepEqual(mirrored.lobby.loadout.weapons, ["mosin", "mp220"]);
    assert.deepEqual(mirrored.lobby.players[1].weapons, ["mosin", "mp220"]);

    await service.start(created.lobby.code, created.memberToken);
    const capturedRequest = request as DuelLobbyMatchRequest | null;
    assert(capturedRequest);
    const duelThrowables = {
        frag: 1,
        mirv: 0,
        potato: 0,
        smoke: 0,
        snowball: 0,
        strobe: 0,
    };
    assert.deepEqual(capturedRequest.contestantLoadouts, [
        { weapons: ["mosin", "mp220"], throwables: duelThrowables },
        { weapons: ["mosin", "mp220"], throwables: duelThrowables },
    ]);
}

const smartBotSource = fs.readFileSync(path.join(__dirname, "smartBot.ts"), "utf8") + "\n" + fs.readFileSync(path.join(__dirname, "bot", "smartBotSupport.ts"), "utf8");
const duelClientSource = fs.readFileSync(
    path.join(__dirname, "../../client/src/ui/duelLobby.ts"),
    "utf8",
);
const duelCssSource = fs.readFileSync(
    path.join(__dirname, "../../client/css/duel-lobby.css"),
    "utf8",
);
assert.match(
    smartBotSource,
    /targetPos: intercept\.aimPoint/,
    "the main exposed-body sampler must preserve the intercept lead",
);
assert.match(
    smartBotSource,
    /finalIntercept[\s\S]{0,1500}targetPos: finalIntercept\.aimPoint/,
    "the final visible-trigger fallback must preserve projectile lead",
);
assert.match(
    smartBotSource,
    /urgentIntercept[\s\S]{0,1800}targetPos: urgentIntercept\.aimPoint/,
    "urgent dodge counterfire must preserve projectile lead",
);
assert.doesNotMatch(
    smartBotSource,
    /const ricochetPrecisionStance = indirectShot\?\.kind === "ricochet"/,
    "V260 must not restore the V257 ricochet stop-and-wait deadlock",
);
assert.doesNotMatch(
    smartBotSource,
    /currentWeapon\.recoilTime <= 0\.015/,
    "forbidden/legit ricochet fire must not wait on impossible recoil recovery",
);
assert.doesNotMatch(
    smartBotSource,
    /Number\(def\.recoilTime \?\? 0\) \* 1000/,
    "local tactical ricochet fire must not derive a wait deadline from huge gun recoilTime values",
);
assert.match(
    smartBotSource,
    /chooseForbiddenIndirectShot\(\{[\s\S]{0,1600}activeDef\.shotSpread/,
    "forbidden/legit ricochet planning must model real weapon spread",
);
assert.match(
    smartBotSource,
    /private calculateRicochetPlan[\s\S]{0,2400}weaponDef\.shotSpread/,
    "local tactical ricochet planning must model real weapon spread",
);
assert.match(
    smartBotSource,
    /type: "ricochet_precision_triggered"/,
    "ricochet trigger attempts must remain recorded for hit-rate diagnosis",
);
assert.match(
    smartBotSource,
    /const ricochetAlignment =/,
    "final packet safety must identify active ricochet intents",
);
assert.match(
    smartBotSource,
    /alignmentWaitMs,\s*ricochetAlignment,/,
    "final packet aim smoothing must keep the dedicated ricochet alignment gate",
);
assert.doesNotMatch(
    smartBotSource,
    /spreadRadians: 0,/,
    "ricochet planners must not assume fictional zero-spread first-shot accuracy",
);
assert.match(duelClientSource, /preserveCommonDraft/);
assert.match(duelClientSource, /commonUpdateInFlight/);
assert.match(duelClientSource, /mutationInFlight/);
assert.match(duelClientSource, /One serialized write lane/);
assert.match(duelClientSource, /lobby\.revision < this\.lobby\.revision/);
assert.match(duelClientSource, /class: "duel-lobby-throwable-copy"/);
assert.match(duelClientSource, /class: "duel-lobby-stepper"/);
assert.match(duelCssSource, /repeat\(auto-fit,minmax\(235px,1fr\)\)/);

void testLobbyTransactionsAndAiMirror().then(() => {
    console.log("V43 lead/UI/lobby regression smoke test passed", {
        preservedVelocity,
        directInterceptTime: intercept.time,
        ricochetMiss: ricochet?.missDistance,
        worstDirectMiss,
        worstRicochetMiss,
    });
});
