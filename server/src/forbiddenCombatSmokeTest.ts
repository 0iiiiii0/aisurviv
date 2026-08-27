import assert from "assert";
import {
    analyzeBulletThreats,
    chooseDodgeDirection,
    chooseForbiddenAirstrikeEscape,
    chooseForbiddenCoverPosition,
    chooseForbiddenEmptyWeaponRecovery,
    chooseForbiddenGrenadeEscape,
    chooseForbiddenGunSlot,
    chooseForbiddenReloadPlan,
    compensateForbiddenContextAge,
    detectPeekBait,
    enemyAimThreat,
    estimateForbiddenTargetVelocity,
    evaluateForbiddenShotPath,
    isForbiddenVolatileCoverUnsafe,
    planForbiddenCounterStrobes,
    planForbiddenStrobeCarpet,
    predictLegitLastSeenPosition,
    simulateForbiddenGrenadeDisplacement,
    simulateForbiddenStrobeDisplacement,
    solveForbiddenGrenadeThrow,
    solveForbiddenStrobeThrow,
    shouldUseAutomaticPrecisionStance,
    shouldForceForbiddenAttackWindow,
    solveIntercept,
    solveInterceptWithSpeedRecovery,
    shouldQuickSwitch,
    updateCadenceEvasionScore,
    type ForbiddenBulletSnapshot,
    type ForbiddenObstacleSnapshot,
} from "./bot/forbiddenCombat.ts";
import { isDuelAiDifficulty } from "./duelLoadout.ts";

const intercept = solveIntercept(
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 0, y: 5 },
    60,
);
assert(intercept.time > 0 && intercept.time < 1);
assert(intercept.aimPoint.y > 2, "moving target must receive positive lead");

const stationary = solveIntercept(
    { x: 0, y: 0 },
    { x: 20, y: 4 },
    { x: 0, y: 0 },
    40,
);
assert(Math.abs(stationary.aimPoint.x - 20) < 1e-6);
assert(Math.abs(stationary.aimPoint.y - 4) < 1e-6);

const bullets: ForbiddenBulletSnapshot[] = [
    {
        id: 1,
        playerId: 2,
        pos: { x: 30, y: 50 },
        dir: { x: 1, y: 0 },
        speed: 35,
        damage: 60,
        remainingDistance: 80,
        bulletType: "test",
        layer: 0,
    },
];
const threats = analyzeBulletThreats({ x: 50, y: 50 }, 1, 0, bullets, 1);
assert.equal(threats.length, 1);
assert(threats[0].closestDistance < 0.01);

const dodge = chooseDodgeDirection({
    botPos: { x: 50, y: 50 },
    botRadius: 1,
    botLayer: 0,
    botPlayerId: 1,
    botMoveSpeed: 8,
    bullets,
    targetPos: { x: 70, y: 50 },
    mapWidth: 100,
    mapHeight: 100,
});
assert(dodge, "direct incoming bullet must produce a dodge solution");
assert(Math.abs(dodge!.direction.y) > 0.2, "best dodge should leave the bullet line");


assert.equal(
    shouldQuickSwitch({
        currentCooldown: 0.72,
        otherCooldown: 0,
        otherAmmo: 5,
        otherInRange: true,
        currentFireMode: "single",
        otherFireMode: "single",
        currentFireDelay: 0.8,
        otherFireDelay: 0.65,
        currentMaxClip: 1,
        currentDeployGroup: 1,
        otherDeployGroup: 1,
        switchDelay: 0.18,
        shotConfirmed: true,
    }),
    true,
    "a designated deploy-group pair may switch when it advances the next legal shot",
);
assert.equal(
    shouldQuickSwitch({
        currentType: "awm",
        otherType: "m39",
        currentCooldown: 1.2,
        otherCooldown: 0,
        otherAmmo: 10,
        otherInRange: true,
        currentFireMode: "single",
        otherFireMode: "single",
        currentFireDelay: 1.5,
        otherFireDelay: 0.18,
        currentMaxClip: 5,
        currentDeployGroup: 0,
        otherDeployGroup: 0,
        switchDelay: 0.3,
        shotConfirmed: false,
    }),
    false,
    "a slow-gun loadout must not swap before the authoritative shot is confirmed",
);
assert.equal(
    shouldQuickSwitch({
        difficulty: "forbidden",
        currentType: "mosin",
        otherType: "sv98",
        currentCooldown: 1.72,
        otherCooldown: 0,
        otherAmmo: 10,
        otherInRange: true,
        currentFireMode: "single",
        otherFireMode: "single",
        currentFireDelay: 1.75,
        otherFireDelay: 1.5,
        currentMaxClip: 5,
        currentDeployGroup: 0,
        otherDeployGroup: 0,
        switchDelay: 1,
        shotConfirmed: true,
    }),
    true,
    "a confirmed Mosin shot must arm a legal SV-98 follow-up even without deployGroup metadata",
);
assert.equal(
    shouldQuickSwitch({
        currentCooldown: 0.3,
        otherCooldown: 0,
        otherAmmo: 30,
        otherInRange: true,
        currentFireMode: "auto",
        otherFireMode: "auto",
        currentFireDelay: 0.09,
        otherFireDelay: 0.09,
        currentMaxClip: 30,
        switchDelay: 0.2,
        shotConfirmed: true,
    }),
    false,
    "automatic weapons must not be pointlessly quick-switched",
);


assert.equal(
    chooseForbiddenGunSlot([
        { slot: 0, loaded: false, reloadable: true, score: 40 },
        { slot: 1, loaded: false, reloadable: false, score: 100 },
    ]),
    0,
    "an empty but reloadable firearm must be selected instead of stranding the bot on fists",
);
assert.equal(
    chooseForbiddenGunSlot([
        { slot: 0, loaded: false, reloadable: true, score: 80 },
        { slot: 1, loaded: true, reloadable: true, score: 20 },
    ]),
    1,
    "a loaded firearm should be preferred during recovery",
);
assert.equal(
    chooseForbiddenGunSlot([
        { slot: 0, loaded: false, reloadable: false, score: 80 },
        { slot: 1, loaded: false, reloadable: false, score: 20 },
    ]),
    -1,
    "melee fallback is allowed only when no firearm can fire or reload",
);


const reloadPlan = chooseForbiddenReloadPlan([
    { slot: 0, ammo: 1, maxClip: 5, reloadable: true, score: 120 },
    { slot: 1, ammo: 0, maxClip: 5, reloadable: true, score: 105 },
], 0);
assert.equal(reloadPlan?.slot, 1, "empty Mosin must be scheduled for recovery even while AWM remains loaded");
assert.equal(reloadPlan?.targetAmmo, 5, "shell-fed rifles must remain in the reload state until the clip is restored");
assert.equal(
    chooseForbiddenReloadPlan([
        { slot: 0, ammo: 30, maxClip: 30, reloadable: true, score: 80 },
        { slot: 1, ammo: 5, maxClip: 5, reloadable: true, score: 110 },
    ], 0),
    null,
    "full firearms must not enter the recovery state",
);

assert.deepEqual(
    chooseForbiddenEmptyWeaponRecovery({
        currentSlot: 0,
        currentAmmo: 0,
        currentReloadable: true,
        otherSlot: 1,
        otherAmmo: 5,
        otherReloadable: true,
        reloading: false,
        reloadPending: false,
    }),
    { kind: "switch", slot: 1 },
    "an empty gun may switch once to a loaded second gun",
);
assert.deepEqual(
    chooseForbiddenEmptyWeaponRecovery({
        currentSlot: 1,
        currentAmmo: 0,
        currentReloadable: true,
        otherSlot: 0,
        otherAmmo: 5,
        otherReloadable: true,
        reloading: false,
        reloadPending: true,
    }),
    { kind: "reload", slot: 1, hold: false },
    "a pending reload must not be interrupted by another slot input",
);
assert.deepEqual(
    chooseForbiddenEmptyWeaponRecovery({
        currentSlot: 1,
        currentAmmo: 0,
        currentReloadable: true,
        otherSlot: 0,
        otherAmmo: 0,
        otherReloadable: true,
        reloading: true,
        reloadPending: true,
    }),
    { kind: "reload", slot: 1, hold: true },
    "a confirmed reload must stay on its current weapon",
);
assert.deepEqual(
    chooseForbiddenEmptyWeaponRecovery({
        currentSlot: 0,
        currentAmmo: 0,
        currentReloadable: false,
        otherSlot: 1,
        otherAmmo: 0,
        otherReloadable: true,
        reloading: false,
        reloadPending: false,
    }),
    { kind: "switch", slot: 1 },
    "when both magazines are empty, select one reloadable slot instead of alternating",
);

assert.deepEqual(
    planForbiddenCounterStrobes(3),
    { barrageCount: 0, reserveCount: 3, carpet: false },
    "inventory alone must not arm an automatic opening barrage",
);
const counterBarrage = planForbiddenCounterStrobes(6, 2);
assert.equal(counterBarrage.barrageCount, 3);
assert.equal(counterBarrage.reserveCount, 3);
assert.equal(counterBarrage.carpet, true);
assert.deepEqual(
    planForbiddenCounterStrobes(12, 5),
    { barrageCount: 4, reserveCount: 8, carpet: true },
    "hostile pressure should trigger a bounded counter-barrage",
);
assert.deepEqual(
    planForbiddenCounterStrobes(12, 0, true),
    { barrageCount: 1, reserveCount: 11, carpet: false },
    "a normal tactical opportunity should use one beacon and preserve inventory",
);

const maxStrobeTravel = simulateForbiddenStrobeDisplacement(
    32.4,
    { x: 1, y: 0 },
    { x: 0, y: 0 },
);
assert(
    maxStrobeTravel.x > 35 && maxStrobeTravel.x < 43,
    "strobe simulation should reproduce the real maximum throw distance",
);

const solvedStrobe = solveForbiddenStrobeThrow(
    { x: 20, y: 50 },
    { x: 49, y: 55 },
    { x: 1.2, y: -0.4 },
);
assert(
    solvedStrobe.error < 0.8,
    "strobe throw solver must land near the desired point while compensating thrower movement",
);
assert(
    solvedStrobe.mouseLen > 8 && solvedStrobe.mouseLen <= 32.4,
    "strobe throw solver must use an ordinary bounded mouse distance",
);

const maxGrenadeTravel = simulateForbiddenGrenadeDisplacement(
    32.4,
    { x: 1, y: 0 },
);
assert(
    maxGrenadeTravel.x > 27 && maxGrenadeTravel.x < 38,
    "grenade simulation should reproduce a strong ordinary throw",
);
const solvedGrenade = solveForbiddenGrenadeThrow({
    botPos: { x: 20, y: 50 },
    botVelocity: { x: 0.8, y: -0.2 },
    desiredImpactPoint: { x: 47, y: 54 },
    layer: 0,
    obstacles: [],
    mapWidth: 100,
    mapHeight: 100,
});
assert(solvedGrenade, "a safe mid-range target should receive a grenade plan");
assert(
    Math.hypot(
        solvedGrenade!.landingPoint.x - 20,
        solvedGrenade!.landingPoint.y - 50,
    ) >= 13.5,
    "planned grenade must land outside its lethal self-damage radius",
);
assert(solvedGrenade!.error < 1, "grenade solver should compensate thrower movement");

const ownGrenadeEscape = chooseForbiddenGrenadeEscape({
    botPos: { x: 20, y: 20 },
    botLayer: 0,
    projectiles: [{
        playerId: 1,
        pos: { x: 24, y: 20 },
        velocity: { x: 0, y: 0 },
        dir: { x: 1, y: 0 },
        fuseTime: 1.1,
        type: "frag",
        layer: 0,
        strikeTime: 0,
        strikeDuration: 0,
        strikeRadius: 0,
    }],
    mapWidth: 100,
    mapHeight: 100,
});
assert(ownGrenadeEscape, "the bot's own live grenade must create an escape vector");
assert(ownGrenadeEscape!.x < -0.8, "self-grenade escape must move away from the blast");

const firstCarpetThrow = planForbiddenStrobeCarpet({
    botPos: { x: 20, y: 50 },
    botVelocity: { x: 0, y: 0 },
    enemyPos: { x: 38, y: 50 },
    enemyVelocity: { x: 4, y: 0 },
    enemyDir: { x: 1, y: 0 },
    layer: 0,
    obstacles: [],
    mapWidth: 100,
    mapHeight: 100,
    throwIndex: 0,
    barrageCount: 5,
    existingTargets: [],
});
assert(firstCarpetThrow, "reachable moving opponent should receive a live strobe plan");
assert(
    Math.hypot(
        firstCarpetThrow!.landingPoint.x - 20,
        firstCarpetThrow!.landingPoint.y - 50,
    ) >= 17,
    "counter strobe must be thrown away from the bot instead of near its feet",
);

const secondCarpetThrow = planForbiddenStrobeCarpet({
    botPos: { x: 20, y: 50 },
    botVelocity: { x: 0, y: 0 },
    enemyPos: { x: 39, y: 50 },
    enemyVelocity: { x: 4, y: 0 },
    enemyDir: { x: 1, y: 0 },
    layer: 0,
    obstacles: [],
    mapWidth: 100,
    mapHeight: 100,
    throwIndex: 1,
    barrageCount: 5,
    existingTargets: [{ pos: firstCarpetThrow!.landingPoint }],
});
assert(secondCarpetThrow, "second live strobe should cover another escape sector");
assert(
    Math.hypot(
        secondCarpetThrow!.landingPoint.x - firstCarpetThrow!.landingPoint.x,
        secondCarpetThrow!.landingPoint.y - firstCarpetThrow!.landingPoint.y,
    ) > 5,
    "rapid strobes must not stack on the same landing point",
);

const redirectedCarpetThrow = planForbiddenStrobeCarpet({
    botPos: { x: 20, y: 50 },
    botVelocity: { x: 0, y: 0 },
    enemyPos: { x: 39, y: 50 },
    enemyVelocity: { x: 0, y: 6 },
    enemyDir: { x: 0, y: 1 },
    layer: 0,
    obstacles: [],
    mapWidth: 100,
    mapHeight: 100,
    throwIndex: 2,
    barrageCount: 5,
    existingTargets: [],
});
assert(redirectedCarpetThrow, "direction-changing opponent should still receive a plan");
assert(
    redirectedCarpetThrow!.landingPoint.y > firstCarpetThrow!.landingPoint.y + 4,
    "later throws must react to the opponent's current movement direction",
);

const wideCoverageThrow = planForbiddenStrobeCarpet({
    botPos: { x: 20, y: 50 },
    botVelocity: { x: 0, y: 0 },
    enemyPos: { x: 39, y: 50 },
    enemyVelocity: { x: 4, y: 0 },
    enemyDir: { x: 1, y: 0 },
    layer: 0,
    obstacles: [],
    mapWidth: 120,
    mapHeight: 120,
    throwIndex: 4,
    barrageCount: 10,
    existingTargets: [
        { pos: firstCarpetThrow!.landingPoint },
        { pos: secondCarpetThrow!.landingPoint },
    ],
    wideCoverage: true,
});
assert(wideCoverageThrow, "wide coverage planning must find an uncovered target");
assert(
    Math.min(
        ...[
            firstCarpetThrow!.landingPoint,
            secondCarpetThrow!.landingPoint,
        ].map((point) =>
            Math.hypot(
                wideCoverageThrow!.landingPoint.x - point.x,
                wideCoverageThrow!.landingPoint.y - point.y,
            ),
        ),
    ) >= 11.4,
    "wide coverage barrage lanes must not cluster around previous beacons",
);

assert.equal(isDuelAiDifficulty("forbidden"), true);
assert.equal(isDuelAiDifficulty("legit"), true);
assert.equal(isDuelAiDifficulty("pro"), true);
assert.equal(isDuelAiDifficulty("easy"), false);

const lastSeenEnemy = {
    id: 2,
    pos: { x: 10, y: 20 },
    velocity: { x: 4, y: -2 },
    dir: { x: 1, y: 0 },
    layer: 0,
    health: 100,
    dead: false,
    downed: false,
    activeWeapon: "ak47",
    curWeapIdx: 0,
    weapons: [],
    actionType: 0,
    actionItem: "",
    actionTime: 0,
    actionDuration: 0,
    zoom: 28,
    indoors: false,
    lineClearFromBot: true,
    shotSlowdownTimer: 0,
    postSlowdownSpeed: 4.5,
};
const rememberedAt300 = predictLegitLastSeenPosition(lastSeenEnemy, 300);
assert(rememberedAt300);
assert(Math.abs(rememberedAt300!.x - 11.2) < 1e-6);
assert(Math.abs(rememberedAt300!.y - 19.4) < 1e-6);
const cappedPrediction = predictLegitLastSeenPosition(lastSeenEnemy, 1000);
assert(cappedPrediction);
assert(Math.abs(cappedPrediction!.x - 11.8) < 1e-6, "LEGIT extrapolation must stop after 450ms");
assert.equal(
    predictLegitLastSeenPosition(lastSeenEnemy, 1451),
    null,
    "LEGIT must discard exact motion after the short human-memory window",
);


const delayedTarget = compensateForbiddenContextAge(
    { x: 20, y: 10 },
    { x: 8, y: 0 },
    0.025,
    0.015,
);
assert(Math.abs(delayedTarget.x - 20.32) < 1e-6, "IPC and tick delay must be included before lead solving");

const blockedVelocity = estimateForbiddenTargetVelocity({
    currentPos: { x: 10.02, y: 5 },
    authoritativeVelocity: { x: 8, y: 0 },
    previousPos: { x: 10, y: 5 },
    previousVelocity: { x: 0.4, y: 0 },
    deltaSeconds: 0.05,
});
assert(blockedVelocity.x < 3.5, "measured wall blocking must reduce excessive rifle lead");

assert.equal(
    shouldUseAutomaticPrecisionStance({
        fireMode: "auto",
        bulletCount: 1,
        moveSpread: 7.5,
        shotSpread: 3.5,
        targetDistance: 28,
        lineClear: true,
        imminentThreat: false,
    }),
    true,
    "long-range Groza-S fire should stop movement before shooting",
);
assert.equal(
    shouldUseAutomaticPrecisionStance({
        fireMode: "auto",
        bulletCount: 1,
        moveSpread: 7.5,
        shotSpread: 3.5,
        targetDistance: 8,
        lineClear: true,
        imminentThreat: false,
    }),
    false,
    "close-range rifle combat should retain movement",
);
assert.equal(
    shouldUseAutomaticPrecisionStance({
        fireMode: "auto",
        bulletCount: 1,
        moveSpread: 7.5,
        shotSpread: 3.5,
        targetDistance: 28,
        lineClear: true,
        imminentThreat: true,
    }),
    false,
    "incoming bullets must override the stationary precision stance",
);
assert.equal(
    shouldForceForbiddenAttackWindow({
        pathAllowsShot: true,
        targetDistance: 12,
        engagementAgeMs: 20,
        msSinceLastShot: 20,
    }),
    true,
    "a visible close opponent must never be suppressed by cover/peek waiting",
);
assert.equal(
    shouldForceForbiddenAttackWindow({
        pathAllowsShot: true,
        targetDistance: 31,
        engagementAgeMs: 900,
        msSinceLastShot: 900,
    }),
    true,
    "a clear long-range engagement must force an attack after a short no-fire timeout",
);
assert.equal(
    shouldForceForbiddenAttackWindow({
        pathAllowsShot: false,
        targetDistance: 12,
        engagementAgeMs: 900,
        msSinceLastShot: 900,
    }),
    false,
    "the no-fire timeout must not shoot through indestructible cover",
);


const recoveryIntercept = solveInterceptWithSpeedRecovery({
    shooterPos: { x: 0, y: 0 },
    targetPos: { x: 24, y: 0 },
    slowedVelocity: { x: 0, y: 3 },
    recoveredVelocity: { x: 0, y: 8 },
    slowdownRemaining: 0.18,
    projectileSpeed: 48,
});
assert(
    recoveryIntercept.aimPoint.y > 2.5,
    "sniper slowdown recovery must increase lead after the debuff ends",
);

const wall: ForbiddenObstacleSnapshot = {
    id: 10,
    type: "wall_test",
    pos: { x: 10, y: 0 },
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
    explosionType: "",
    explosionRadius: 0,
    collider: { type: 1, min: { x: 9, y: -2 }, max: { x: 11, y: 2 } },
};
const oilBarrel: ForbiddenObstacleSnapshot = {
    ...wall,
    id: 14,
    type: "barrel_01",
    health: 150,
    maxHealth: 150,
    healthT: 1,
    destructible: true,
    explosionType: "explosion_barrel",
    explosionRadius: 8,
    collider: { type: 0, pos: { x: 10, y: 0 }, rad: 1.75 },
};
assert.equal(
    isForbiddenVolatileCoverUnsafe(oilBarrel, {
        obstacleDamagePerShot: 270,
        fireDelaySeconds: 1,
    }),
    true,
    "an AWM-S one-shot oil barrel must never be selected as close cover",
);
assert.equal(
    isForbiddenVolatileCoverUnsafe(
        { ...oilBarrel, health: 60, healthT: 0.4 },
        { obstacleDamagePerShot: 11, fireDelaySeconds: 0.09 },
    ),
    true,
    "a low-health oil barrel must be unsafe even against a weaker weapon",
);
assert.equal(
    chooseForbiddenCoverPosition({
        botPos: { x: 3, y: 5 },
        enemyPos: { x: 18, y: 5 },
        layer: 0,
        obstacles: [{ ...oilBarrel, pos: { x: 10, y: 5 }, collider: { type: 0, pos: { x: 10, y: 5 }, rad: 1.75 } }],
        mapWidth: 40,
        mapHeight: 30,
        mode: "sniper",
        desiredRange: 20,
        enemyCoverThreat: {
            obstacleDamagePerShot: 270,
            fireDelaySeconds: 1,
        },
    }),
    null,
    "volatile cover that the enemy can one-shot must be excluded from cover planning",
);
assert.equal(
    solveForbiddenGrenadeThrow({
        botPos: { x: 0, y: 0 },
        botVelocity: { x: 0, y: 0 },
        desiredImpactPoint: { x: 24, y: 0 },
        layer: 0,
        obstacles: [{
            ...wall,
            id: 13,
            pos: { x: 5, y: 0 },
            collider: { type: 1, min: { x: 4, y: -2 }, max: { x: 6, y: 2 } },
        }],
        mapWidth: 100,
        mapHeight: 100,
    }),
    null,
    "a close wall that can bounce the grenade back must cancel the throw",
);
assert.equal(
    evaluateForbiddenShotPath({
        from: { x: 0, y: 0 },
        to: { x: 20, y: 0 },
        layer: 0,
        obstacles: [wall],
        bulletDamage: 40,
        obstacleDamage: 1,
        armorPiercing: false,
        stonePiercing: false,
        enemyPos: { x: 20, y: 0 },
        enemyHealth: 100,
        enemyHealing: false,
    }).kind,
    "hold",
    "indestructible cover must suppress the shot",
);

const weakCrate: ForbiddenObstacleSnapshot = {
    ...wall,
    id: 11,
    type: "crate_test",
    health: 50,
    maxHealth: 100,
    healthT: 0.5,
    destructible: true,
};
assert.equal(
    evaluateForbiddenShotPath({
        from: { x: 0, y: 0 },
        to: { x: 20, y: 0 },
        layer: 0,
        obstacles: [weakCrate],
        bulletDamage: 30,
        obstacleDamage: 1,
        armorPiercing: false,
        stonePiercing: false,
        enemyPos: { x: 20, y: 0 },
        enemyHealth: 100,
        enemyHealing: false,
    }).kind,
    "destroy",
    "cheap destructible cover should be deliberately removed",
);
assert.equal(
    evaluateForbiddenShotPath({
        from: { x: 0, y: 0 },
        to: { x: 20, y: 0 },
        layer: 0,
        obstacles: [{ ...weakCrate, health: 180, maxHealth: 180, healthT: 1 }],
        bulletDamage: 30,
        obstacleDamage: 1,
        armorPiercing: false,
        stonePiercing: false,
        enemyPos: { x: 20, y: 0 },
        enemyHealth: 100,
        enemyHealing: false,
        enemyUsingCover: true,
        targetDistance: 18,
    }).kind,
    "destroy",
    "repeatedly used destructible cover should be removed when the ammo/time cost is reasonable",
);

const barrel: ForbiddenObstacleSnapshot = {
    ...weakCrate,
    id: 12,
    type: "barrel_01",
    pos: { x: 10, y: 0 },
    explosionType: "explosion_barrel",
    explosionRadius: 12,
};
assert.equal(
    evaluateForbiddenShotPath({
        from: { x: 0, y: 0 },
        to: { x: 20, y: 0 },
        layer: 0,
        obstacles: [barrel],
        bulletDamage: 30,
        obstacleDamage: 1,
        armorPiercing: false,
        stonePiercing: false,
        enemyPos: { x: 18, y: 0 },
        enemyHealth: 100,
        enemyHealing: false,
    }).kind,
    "explode",
    "an explosive barrel beside a hidden player should become the aim point",
);

assert(
    enemyAimThreat({
        shooterPos: { x: 20, y: 0 },
        shooterDir: { x: -1, y: 0 },
        targetPos: { x: 0, y: 0.2 },
        weaponRange: 40,
        weaponReady: true,
        spreadRadians: 0.02,
    }) > 0.6,
    "a ready enemy weapon aimed at the bot must create pre-shot danger",
);
assert.equal(
    detectPeekBait([
        { visible: false, timestamp: 0 },
        { visible: true, timestamp: 100 },
        { visible: false, timestamp: 210 },
        { visible: true, timestamp: 400 },
        { visible: false, timestamp: 520 },
    ]),
    true,
    "two short exposure windows should be classified as fake-peek bait",
);

assert.equal(
    shouldQuickSwitch({
        currentType: "p30l_dual",
        otherType: "p30l",
        currentCooldown: 0.07,
        otherCooldown: 0,
        otherAmmo: 15,
        otherInRange: true,
        currentFireMode: "single",
        otherFireMode: "single",
        currentFireDelay: 0.09,
        otherFireDelay: 0.14,
        currentMaxClip: 30,
        currentDeployGroup: 0,
        otherDeployGroup: 0,
        switchDelay: 0.25,
        shotConfirmed: true,
        mobilityThreat: true,
    }),
    false,
    "mobility pressure alone must not trigger rapid switching for an unmarked weapon pair",
);

assert(
    updateCadenceEvasionScore({
        score: 1.6,
        elapsedMs: 40,
        previousLateralSign: 1,
        currentLateralSign: -1,
        msSinceLastShot: 120,
    }) > 2.5,
    "a repeated lateral reversal inside the post-shot reaction window must trigger anti-cadence tactics",
);
assert(
    updateCadenceEvasionScore({
        score: 1.6,
        elapsedMs: 40,
        previousLateralSign: 1,
        currentLateralSign: -1,
        msSinceLastShot: 700,
    }) < 1.6,
    "unrelated late strafing must not be mistaken for attack-interval evasion",
);


const coverChoice = chooseForbiddenCoverPosition({
    botPos: { x: 4, y: 0 },
    enemyPos: { x: 20, y: 0 },
    layer: 0,
    obstacles: [wall],
    mapWidth: 100,
    mapHeight: 100,
    mode: "reload",
    desiredRange: 22,
});
assert(coverChoice?.blocksEnemy, "reload movement must select a point hidden by hard cover");

const airstrikeEscape = chooseForbiddenAirstrikeEscape({
    botPos: { x: 50, y: 50 },
    botLayer: 0,
    botPlayerId: 1,
    mapWidth: 100,
    mapHeight: 100,
    projectiles: [
        {
            playerId: 2,
            pos: { x: 48, y: 50 },
            velocity: { x: 0, y: 0 },
            dir: { x: 1, y: 0 },
            fuseTime: 10,
            type: "strobe",
            layer: 0,
            strikeTime: 1.2,
            strikeDuration: 4.8,
            strikeRadius: 13,
        },
        {
            playerId: 2,
            pos: { x: 52, y: 50 },
            velocity: { x: 0, y: 0 },
            dir: { x: -1, y: 0 },
            fuseTime: 10,
            type: "strobe",
            layer: 0,
            strikeTime: 1.6,
            strikeDuration: 4.8,
            strikeRadius: 13,
        },
    ],
});
assert(airstrikeEscape && airstrikeEscape.hazards === 2, "overlapping hostile strobes must be evaluated together");
assert(airstrikeEscape!.danger > 30, "consecutive hostile strobes must create an urgent escape plan");

const immediateThrownStrobeEscape = chooseForbiddenAirstrikeEscape({
    botPos: { x: 50, y: 50 },
    botLayer: 0,
    botPlayerId: 1,
    mapWidth: 100,
    mapHeight: 100,
    projectiles: [{
        playerId: 2,
        pos: { x: 52, y: 50 },
        velocity: { x: 0, y: 0 },
        dir: { x: 1, y: 0 },
        fuseTime: 13.4,
        type: "strobe",
        layer: 0,
        strikeTime: 2.48,
        strikeDuration: 3.25,
        strikeRadius: 17,
    }],
});
assert(
    immediateThrownStrobeEscape,
    "AI must begin escaping immediately after an opponent throws the strobe",
);

console.log(
    "Forbidden AI smoke test passed: exact intercept, delayed-context compensation, blocked-motion filtering, automatic-rifle precision stance, speed-recovery lead, cover/explosive planning, aim-ray danger, fake-peek and cadence-evasion detection, world-bullet threat analysis, sampled dodge, legal quickswitch, firearm recovery and difficulty validation.",
);
