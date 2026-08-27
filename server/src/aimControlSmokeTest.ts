import assert from "assert";

import {
    angularDistance,
    normalizeDirection,
    predictTrackedAimDirection,
    reloadStateBlocksGunfire,
    rotateDirectionTowards,
    shortestAngleDelta,
    shouldDelayGunfire,
} from "./bot/aimControl.ts";

const deg = (value: number): number => (value * Math.PI) / 180;

const invalid = normalizeDirection({ x: Number.NaN, y: 0 }, { x: 0, y: 2 });
assert.ok(Math.abs(invalid.x) < 1e-9);
assert.ok(Math.abs(invalid.y - 1) < 1e-9);

assert.ok(Math.abs(shortestAngleDelta(deg(179), deg(-179)) - deg(2)) < 1e-9);
assert.ok(Math.abs(shortestAngleDelta(deg(-179), deg(179)) + deg(2)) < 1e-9);

const start = { x: 1, y: 0 };
const opposite = { x: -1, y: 0 };
const firstFrame = rotateDirectionTowards(start, opposite, deg(500), 16);
const firstFrameTurn = angularDistance(start, firstFrame);
assert.ok(firstFrameTurn > deg(7.9) && firstFrameTurn < deg(8.1));
assert.ok(angularDistance(firstFrame, opposite) > deg(170));

// A stalled event loop must not turn the delayed packet into an instant snap.
const delayedFrame = rotateDirectionTowards(start, opposite, deg(500), 1000);
const delayedTurn = angularDistance(start, delayedFrame);
assert.ok(delayedTurn > deg(49.9) && delayedTurn < deg(50.1));

let direction = start;
for (let index = 0; index < 30; index += 1) {
    direction = rotateDirectionTowards(direction, opposite, deg(500), 16);
}
assert.ok(angularDistance(direction, opposite) < 1e-6);


const tracked = predictTrackedAimDirection(
    { x: 10, y: 10 },
    { x: 20, y: 10 },
    { x: 0, y: 10 },
    0.1,
);
assert.ok(tracked.x > 0.99);
assert.ok(tracked.y > 0.09 && tracked.y < 0.11);
assert.equal(shouldDelayGunfire(deg(30), true), true);
assert.equal(shouldDelayGunfire(deg(5), false), false);
assert.equal(
    shouldDelayGunfire(deg(1), false, true),
    true,
    "sniper fire must wait for sub-degree alignment",
);
assert.equal(shouldDelayGunfire(deg(0.5), false, true), false);
assert.equal(
    shouldDelayGunfire(deg(2), false, true, 120),
    true,
    "a precision gun must still wait during the initial turn",
);
assert.equal(
    shouldDelayGunfire(deg(2), false, true, 300),
    false,
    "a stable near-aligned firing request must not be suppressed forever",
);
assert.equal(
    shouldDelayGunfire(deg(18), true, false, 1000),
    true,
    "the recovery deadline must not permit a shot during a large target switch",
);
assert.equal(
    shouldDelayGunfire(0.0008, true, false, 0, true),
    true,
    "ricochet geometry must keep the proven 0.0006-rad initial alignment gate",
);
assert.equal(
    shouldDelayGunfire(0.0008, true, false, 160, true),
    false,
    "a continuously requested near-aligned ricochet gets only a tiny safe recovery window",
);
assert.equal(
    shouldDelayGunfire(0.001, true, false, 1000, true),
    true,
    "ricochet recovery must reject errors beyond the authoritative 0.0009-rad envelope",
);
assert.equal(
    shouldDelayGunfire(0.0005, true, false, 0, true),
    false,
    "ricochet geometry may fire immediately inside the original exact gate",
);
assert.equal(reloadStateBlocksGunfire(true, 29, 30), true);
assert.equal(
    reloadStateBlocksGunfire(true, 30, 30),
    false,
    "a full clip must not be locked by a stale reload action",
);
assert.equal(reloadStateBlocksGunfire(false, 0, 30), false);

const smallTarget = { x: Math.cos(deg(5)), y: Math.sin(deg(5)) };
const noOvershoot = rotateDirectionTowards(start, smallTarget, deg(500), 16);
assert.ok(angularDistance(noOvershoot, smallTarget) < 1e-9);

console.log("Aim control smoke test passed: reload tracking can turn smoothly without one-frame snapping.");
