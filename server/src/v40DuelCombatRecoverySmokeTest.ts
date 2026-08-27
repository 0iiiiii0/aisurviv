import assert from "assert";
import fs from "fs";
import path from "path";
import {
    chooseForbiddenCoverPressurePoint,
    chooseForbiddenIndirectShot,
    evaluateForbiddenGrenadeOpportunity,
    findForbiddenExposedAimPoint,
    firstForbiddenLineBlocker,
    shouldUseSingleShotPrecisionBrake,
    solvePeekInterceptWindow,
    supportsForbiddenMapRicochet,
    type ForbiddenObstacleSnapshot,
} from "./bot/forbiddenCombat.ts";


const smartBotSource = fs.readFileSync(path.join(__dirname, "smartBot.ts"), "utf8") + "\n" + fs.readFileSync(path.join(__dirname, "bot", "smartBotSupport.ts"), "utf8");
assert.match(
    smartBotSource,
    /const exactDirectBodyWindow = Boolean\(exposedAim\) \|\| shotPath\.kind === "clear";/,
    "close-range aggression must be gated by exact body/collider geometry",
);
assert.doesNotMatch(
    smartBotSource,
    /const closeClearEngagement =[\s\S]{0,140}enemy\.lineClearFromBot/,
    "the coarse visibility flag must not authorize a close-range center shot",
);
assert.match(
    smartBotSource,
    /Always solve the legal body[\s\S]{0,900}findForbiddenExposedAimPoint/,
    "the final trigger fallback must always solve an authoritative exposed-body point",
);
assert.match(
    smartBotSource,
    /!exactDirectBodyWindow &&[\s\S]{0,80}!peekPrefire[\s\S]{0,80}activeDef\?\.type === "gun"/,
    "ricochet/explosive planning must also compete with shooting destructible cover",
);

const obstacle = (
    value: Partial<ForbiddenObstacleSnapshot> &
        Pick<ForbiddenObstacleSnapshot, "id" | "type" | "pos" | "collider">,
): ForbiddenObstacleSnapshot => ({
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
    reflectBullets: false,
    explosionType: "",
    explosionRadius: 0,
    ...value,
});

// Reproduction from the final uploaded match. The centre ray crosses the exact
// rotated sandbag AABB; the old local radius approximation incorrectly restored
// the trigger and quick-switched into a second sandbag shot.
const finalMatchSandbag = obstacle({
    id: 6,
    type: "sandbags_01",
    pos: { x: 126.72068360418098, y: 58.48526741435874 },
    collider: {
        type: 1,
        min: { x: 125.32068360418097, y: 55.38526741435874 },
        max: { x: 128.120683604181, y: 61.58526741435874 },
    },
});
const finalMatchBot = { x: 132.7677, y: 56.3134 };
const finalMatchEnemy = { x: 124.3144, y: 61.5634 };
assert.equal(
    firstForbiddenLineBlocker(
        finalMatchBot,
        finalMatchEnemy,
        0,
        [finalMatchSandbag],
    )?.id,
    6,
    "the final-match centre shot must be classified as a sandbag hit",
);
const finalMatchExposure = findForbiddenExposedAimPoint({
    shooterPos: finalMatchBot,
    targetPos: finalMatchEnemy,
    targetRadius: 1,
    layer: 0,
    obstacles: [finalMatchSandbag],
    preferredDirection: { x: 0, y: 1 },
});
if (finalMatchExposure) {
    assert.notDeepEqual(
        finalMatchExposure.point,
        finalMatchEnemy,
        "a partial exposure must aim at the exposed body, not the blocked centre",
    );
    assert.equal(
        firstForbiddenLineBlocker(
            finalMatchBot,
            finalMatchExposure.point,
            0,
            [finalMatchSandbag],
        ),
        null,
        "the selected exposed-body ray must not intersect the sandbag",
    );
}

const peekWall = obstacle({
    id: 11,
    type: "sandbags_01",
    pos: { x: 10, y: 0 },
    collider: {
        type: 1,
        min: { x: 9, y: -2.5 },
        max: { x: 11, y: 2.5 },
    },
});
const peek = solvePeekInterceptWindow({
    shooterPos: { x: 0, y: 0 },
    targetPos: { x: 14, y: 0 },
    targetRadius: 1,
    slowedVelocity: { x: 0, y: 7.2 },
    recoveredVelocity: { x: 0, y: 7.2 },
    slowdownRemaining: 0,
    projectileSpeed: 35,
    layer: 0,
    obstacles: [peekWall],
    currentBlockerId: 11,
    horizon: 1.2,
    maxFireLead: 0.3,
});
assert(peek, "a predictable sandbag exit must create a timed peek intercept");
assert(
    peek!.fireIn >= -0.055 && peek!.fireIn <= 0.3,
    "peek timing must place projectile arrival at first exposure",
);
assert.equal(
    firstForbiddenLineBlocker(
        { x: 0, y: 0 },
        peek!.aimPoint,
        0,
        [peekWall],
    ),
    null,
    "prefire may target an empty future point but may never travel through cover",
);

assert.equal(
    evaluateForbiddenGrenadeOpportunity({
        directLineClear: true,
        exposedFraction: 1,
        enemyHealing: true,
        healRemainingMs: 2600,
        targetSpeed: 0,
        distance: 25,
        botHealth: 100,
        imminentThreat: false,
        sinceLastThrowMs: 9000,
        estimatedArrivalMs: 1500,
        selfBlastDistance: 25,
        behindHardCover: true,
        enemyWeaponReady: false,
        hasSafeLanding: true,
    }).reason,
    "direct-window",
    "a grenade must not replace a clean gunshot",
);
const healGrenade = evaluateForbiddenGrenadeOpportunity({
    directLineClear: false,
    exposedFraction: 0,
    enemyHealing: true,
    healRemainingMs: 2600,
    targetSpeed: 0.25,
    distance: 25,
    botHealth: 100,
    imminentThreat: false,
    sinceLastThrowMs: 9000,
    estimatedArrivalMs: 1550,
    selfBlastDistance: 25,
    behindHardCover: true,
    enemyWeaponReady: false,
    hasSafeLanding: true,
});
assert.equal(healGrenade.use, true, "healing behind hard cover should be punished by a timed grenade");
assert.equal(healGrenade.reason, "heal-punish");
assert.equal(
    evaluateForbiddenGrenadeOpportunity({
        directLineClear: false,
        exposedFraction: 0,
        enemyHealing: true,
        healRemainingMs: 350,
        targetSpeed: 0,
        distance: 25,
        botHealth: 100,
        imminentThreat: false,
        sinceLastThrowMs: 9000,
        estimatedArrivalMs: 1550,
        selfBlastDistance: 25,
        behindHardCover: true,
        enemyWeaponReady: false,
        hasSafeLanding: true,
    }).reason,
    "heal-too-short",
    "a grenade arriving after the heal window must be rejected",
);
assert.equal(
    evaluateForbiddenGrenadeOpportunity({
        directLineClear: false,
        exposedFraction: 0,
        enemyHealing: false,
        healRemainingMs: 0,
        targetSpeed: 7.2,
        distance: 25,
        botHealth: 100,
        imminentThreat: false,
        sinceLastThrowMs: 9000,
        estimatedArrivalMs: 1300,
        selfBlastDistance: 25,
        behindHardCover: true,
        enemyWeaponReady: false,
        hasSafeLanding: true,
    }).use,
    false,
    "a fast moving non-healing target must not steal a gun cycle for a grenade",
);

const pressure = chooseForbiddenCoverPressurePoint({
    botPos: { x: 20, y: 0 },
    enemyPos: { x: 13, y: 0 },
    layer: 0,
    blocker: peekWall,
    obstacles: [peekWall],
    mapWidth: 100,
    mapHeight: 100,
    preferredSide: 1,
});
assert(pressure, "healing cover must produce a collision-checked breach point");

assert.equal(
    shouldUseSingleShotPrecisionBrake({
        fireMode: "single",
        fireDelay: 0.75,
        moveSpread: 8,
        shotSpread: 0.5,
        targetDistance: 30,
        lineClear: true,
        imminentThreat: false,
        botSpeed: 7,
        enemyHealing: false,
        healRemainingMs: 0,
        peekPrefire: false,
    }),
    true,
    "a moving Mosin-class shot should settle briefly before firing",
);
assert.equal(
    shouldUseSingleShotPrecisionBrake({
        fireMode: "single",
        fireDelay: 0.75,
        moveSpread: 8,
        shotSpread: 0.5,
        targetDistance: 30,
        lineClear: true,
        imminentThreat: false,
        botSpeed: 7,
        enemyHealing: false,
        healRemainingMs: 0,
        peekPrefire: true,
    }),
    false,
    "the first-frame peek intercept must not be lost to a settle delay",
);

const reflector = obstacle({
    id: 20,
    type: "stone_01",
    pos: { x: 10, y: 10.5 },
    reflectBullets: true,
    collider: {
        type: 1,
        min: { x: 8, y: 10 },
        max: { x: 12, y: 11 },
    },
});
assert.equal(
    supportsForbiddenMapRicochet({
        isGun: true,
        isLauncher: false,
        hasOnHitEffect: false,
    }),
    true,
    "ordinary Mosin/AK/M39 bullets must be allowed to use reflective map surfaces",
);
assert.equal(
    supportsForbiddenMapRicochet({
        isGun: true,
        isLauncher: false,
        hasOnHitEffect: true,
    }),
    false,
    "on-hit explosive rounds must not be planned as ordinary ricochets",
);

const ricochet = chooseForbiddenIndirectShot({
    from: { x: 0, y: 0 },
    enemyPos: { x: 20, y: 0 },
    layer: 0,
    obstacles: [reflector],
    bulletRange: 90,
    bulletDamage: 55,
    obstacleDamage: 1,
    armorPiercing: false,
    stonePiercing: false,
    canRicochet: true,
    targetRadius: 1,
    enemyHealing: true,
});
assert.equal(ricochet?.kind, "ricochet", "body-radius aware one-bounce pressure must be found");
const movingRicochet = chooseForbiddenIndirectShot({
    from: { x: 0, y: 0 },
    enemyPos: { x: 20, y: 0 },
    enemyVelocity: { x: 0, y: 3.2 },
    bulletSpeed: 35,
    layer: 0,
    obstacles: [reflector],
    bulletRange: 90,
    bulletDamage: 55,
    obstacleDamage: 1,
    armorPiercing: false,
    stonePiercing: false,
    canRicochet: true,
    targetRadius: 1,
    enemyHealing: false,
});
assert.equal(
    movingRicochet?.kind,
    "ricochet",
    "one-bounce planning must lead a moving target by the full reflected flight time",
);

console.log("V40 duel combat recovery smoke test passed", {
    finalMatchExposure,
    peek,
    healGrenade,
    pressure,
    ricochet,
});
