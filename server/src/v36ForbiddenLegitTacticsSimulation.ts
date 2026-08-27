import assert from "assert";
import { writeFileSync } from "fs";
import {
    chooseForbiddenGunLineDodge,
    chooseForbiddenIndirectShot,
    shouldAllowForbiddenOmniscientGunfire,
    solveForbiddenGrenadeThrow,
    type ForbiddenObstacleSnapshot,
} from "./bot/forbiddenCombat.ts";

const baseObstacle = (
    partial: Partial<ForbiddenObstacleSnapshot> & Pick<ForbiddenObstacleSnapshot, "id" | "type" | "pos" | "collider">,
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
    ...partial,
} as ForbiddenObstacleSnapshot);

const hardWall = baseObstacle({
    id: 1,
    type: "warehouse_wall_side",
    pos: { x: 10, y: 0 },
    collider: { type: 1, min: { x: 9.5, y: -4 }, max: { x: 10.5, y: 4 } },
});
const meaningless = chooseForbiddenIndirectShot({
    from: { x: 0, y: 0 },
    enemyPos: { x: 20, y: 0 },
    layer: 0,
    obstacles: [hardWall],
    bulletRange: 80,
    bulletDamage: 50,
    obstacleDamage: 1,
    armorPiercing: false,
    stonePiercing: false,
    canRicochet: true,
});
assert.equal(meaningless, null, "non-reflective indestructible cover must never be fired at");

const reflector = baseObstacle({
    id: 2,
    type: "metal_barrier",
    pos: { x: 10, y: 10.5 },
    reflectBullets: true,
    collider: { type: 1, min: { x: 8, y: 10 }, max: { x: 12, y: 11 } },
});
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
});
assert.equal(ricochet?.kind, "ricochet", "a legal one-bounce route must be selected");
assert(Math.abs((ricochet?.aimPoint.x ?? 0) - 10) < 0.6, "ricochet point should use the mirror geometry");

const barrel = baseObstacle({
    id: 3,
    type: "barrel_01",
    pos: { x: 14, y: 0 },
    destructible: true,
    reflectBullets: true,
    explosionType: "barrel_explosion",
    explosionRadius: 6,
    health: 42,
    maxHealth: 42,
    collider: { type: 0, pos: { x: 14, y: 0 }, rad: 1.15 },
});
const barrelPlan = chooseForbiddenIndirectShot({
    from: { x: 0, y: 0 },
    enemyPos: { x: 17.5, y: 1 },
    layer: 0,
    obstacles: [barrel],
    bulletRange: 80,
    bulletDamage: 45,
    obstacleDamage: 1,
    armorPiercing: false,
    stonePiercing: false,
    canRicochet: true,
});
assert.equal(barrelPlan?.kind, "explode", "an oil barrel near a hidden enemy should be detonated");

const dodge = chooseForbiddenGunLineDodge({
    botPos: { x: 20, y: 0 },
    enemyPos: { x: 0, y: 0 },
    enemyDir: { x: 1, y: 0 },
    enemyRange: 80,
    enemyReady: true,
    layer: 0,
    obstacles: [],
    mapWidth: 100,
    mapHeight: 100,
    preferredSide: 1,
});
assert(dodge, "an enemy gun line through the bot must produce proactive evasion");
assert(Math.abs(dodge!.direction.y) > 0.75, "gun-line dodge must be predominantly lateral");

const grenade = solveForbiddenGrenadeThrow({
    botPos: { x: 20, y: 20 },
    botVelocity: { x: 0, y: 0 },
    desiredImpactPoint: { x: 48, y: 20 },
    layer: 0,
    obstacles: [],
    mapWidth: 100,
    mapHeight: 100,
    flightSeconds: 1.65,
});
assert(grenade, "a medium-range timed grenade plan should exist");
assert(grenade!.impactSpeed >= 4.25, "grenade must still be moving when it meets the target");
assert(grenade!.cookMs >= 1900, "fuse cooking must consume the unused flight time");
const residualFuseMs = 4000 - grenade!.cookMs - grenade!.flightSeconds * 1000;
assert(residualFuseMs >= 35 && residualFuseMs <= 90, "grenade should detonate just after target encounter");

assert.equal(
    shouldAllowForbiddenOmniscientGunfire({ difficulty: "forbidden", onScreen: false, legalIntentFresh: true }),
    true,
    "HACKER must retain off-screen gunfire when the authoritative path is legal",
);
assert.equal(
    shouldAllowForbiddenOmniscientGunfire({ difficulty: "forbidden", onScreen: false, legalIntentFresh: false }),
    false,
    "HACKER must not fire off-screen without a fresh legal path intent",
);
assert.equal(
    shouldAllowForbiddenOmniscientGunfire({ difficulty: "legit", onScreen: false, legalIntentFresh: true }),
    false,
    "LEGIT must remain restricted to its active scope",
);

const result = {
    hardCoverWastePrevented: meaningless === null,
    ricochet: {
        kind: ricochet?.kind,
        aimPoint: ricochet?.aimPoint,
        totalDistance: ricochet?.totalDistance,
    },
    barrel: {
        kind: barrelPlan?.kind,
        obstacle: barrelPlan?.obstacle.type,
    },
    gunLineDodge: dodge,
    grenade: grenade && {
        flightSeconds: grenade.flightSeconds,
        impactSpeed: grenade.impactSpeed,
        cookMs: grenade.cookMs,
        residualFuseMs,
        error: grenade.error,
    },
    offscreenPolicy: {
        hackerLegal: true,
        hackerWithoutIntent: false,
        legitOffscreen: false,
    },
};
writeFileSync("../V36_FORBIDDEN_LEGIT_TACTICS_SIMULATION.json", JSON.stringify(result, null, 2));
console.log("V36 Forbidden/LEGIT tactics simulation passed", result);
