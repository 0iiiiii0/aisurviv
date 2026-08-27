import assert from "assert";
import {
    solveForbiddenGrenadeThrow,
    solveForbiddenPrimedGrenadeRelease,
} from "./bot/forbiddenCombat.ts";

const base = {
    botPos: { x: 50, y: 50 },
    botVelocity: { x: 0, y: 0 },
    layer: 0,
    obstacles: [] as const,
    mapWidth: 220,
    mapHeight: 220,
};

for (const distance of [14.5, 18, 20, 25, 28, 30]) {
    const plan = solveForbiddenGrenadeThrow({
        ...base,
        desiredImpactPoint: { x: 50 + distance, y: 50 },
    });
    assert(plan, `airburst plan must exist at ${distance} units`);
    assert(plan.error <= 1.5, `landing error must stay precise at ${distance}`);
    assert(plan.impactSpeed >= 4.25, `grenade must still be moving at ${distance}`);
    assert(
        plan.flightSeconds >= 1.2 && plan.flightSeconds <= 1.68,
        `planner should choose a long useful flight at ${distance}`,
    );
    const residualFuseMs = 4000 - plan.cookMs - plan.flightSeconds * 1000;
    assert(
        residualFuseMs >= 20 && residualFuseMs <= 120,
        `detonation should follow target crossing closely at ${distance}`,
    );
}

const midRange = solveForbiddenGrenadeThrow({
    ...base,
    desiredImpactPoint: { x: 70, y: 50 },
});
assert(midRange);
assert(
    midRange.cookMs <= 2700,
    "20-unit throw should not return to the old >3s high-speed/short-flight cook pattern",
);

const movingThrower = solveForbiddenGrenadeThrow({
    ...base,
    botVelocity: { x: 3.5, y: -2.25 },
    desiredImpactPoint: { x: 75, y: 54 },
});
assert(movingThrower, "moving thrower must still receive a solution");
assert(movingThrower.error <= 1.5, "0.6x inherited bot velocity must be compensated");

const primed = solveForbiddenPrimedGrenadeRelease({
    ...base,
    desiredImpactPoint: { x: 75, y: 50 },
    remainingFuseSeconds: 1.58,
});
assert(primed, "primed grenade must be re-solvable from remaining fuse");
assert(primed.error <= 1.5, "primed re-solve must retain landing precision");
assert(
    Math.abs(1.58 - 0.055 - primed.flightSeconds) <= 0.04,
    "primed solver must make flight time match immutable remaining fuse",
);

const tooEarly = solveForbiddenPrimedGrenadeRelease({
    ...base,
    desiredImpactPoint: { x: 75, y: 50 },
    remainingFuseSeconds: 2.8,
});
assert.equal(
    tooEarly,
    null,
    "a grenade with too much fuse remaining should keep cooking instead of pretending a precise airburst exists",
);

console.log("Grenade airburst timing smoke test passed: long-flight cook reduction, moving-thrower compensation and remaining-fuse re-solve are valid.");
