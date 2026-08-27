import assert from "assert/strict";

import { findAirstrikePlaneSpawnAndDirection } from "./game/objects/plane.ts";
import { predictStrobeAirstrikeWarning } from "./game/objects/projectile.ts";

const assertFinitePlan = (
    target: { x: number; y: number },
    dir: { x: number; y: number },
    width: number,
    height: number,
    sideOffset: number,
): void => {
    const plan = findAirstrikePlaneSpawnAndDirection(
        target,
        dir,
        width,
        height,
        100,
        sideOffset,
    );
    assert(Number.isFinite(plan.spawn.x));
    assert(Number.isFinite(plan.spawn.y));
    assert(Number.isFinite(plan.newDir.x));
    assert(Number.isFinite(plan.newDir.y));
    assert(Math.abs(Math.hypot(plan.newDir.x, plan.newDir.y) - 1) < 1e-6);
};

assertFinitePlan({ x: 0.5, y: 0.5 }, { x: 1, y: 0 }, 176, 136, 0);
assertFinitePlan({ x: 175.5, y: 135.5 }, { x: -1, y: 0 }, 176, 136, 8);
assertFinitePlan({ x: 88, y: 68 }, { x: 0, y: 0 }, 176, 136, -8);
assertFinitePlan({ x: Number.NaN, y: Infinity }, { x: Number.NaN, y: 0 }, 176, 136, Infinity);

const thrownAt = 10_000;
const ordinaryWarning = predictStrobeAirstrikeWarning(
    {
        pos: { x: 20, y: 30 },
        vel: { x: 30, y: 0 },
        posZ: 0.5,
        velZ: 5,
        createdAtMs: thrownAt,
    },
    false,
    176,
    136,
    thrownAt,
);
assert(ordinaryWarning, "a newly thrown strobe must immediately create an AI warning");
assert(ordinaryWarning!.pos.x > 35, "warning must predict the future landing point");
assert.equal(ordinaryWarning!.rad, 17);

const brokenArrowWarning = predictStrobeAirstrikeWarning(
    {
        pos: { x: 20, y: 30 },
        vel: { x: 30, y: 0 },
        posZ: 0.5,
        velZ: 5,
        createdAtMs: thrownAt,
    },
    true,
    176,
    136,
    thrownAt,
);
assert(brokenArrowWarning);
assert(
    brokenArrowWarning!.rad > ordinaryWarning!.rad,
    "Broken Arrow prediction must reserve a wider evacuation radius",
);

console.log(
    "Airstrike safety smoke test passed: finite plane paths and immediate predicted strobe evacuation zones.",
);
