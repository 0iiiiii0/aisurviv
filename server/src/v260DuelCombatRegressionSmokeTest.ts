import assert from "assert/strict";
import fs from "fs";
import path from "path";

import { shouldDelayGunfire } from "./bot/aimControl.ts";
import { stabilizeMovementDirection } from "./bot/movementInput.ts";

const source = fs.readFileSync(path.resolve(__dirname, "smartBot.ts"), "utf8");

// V257 regression: the forbidden ricochet planner assumed zero spread and then
// waited for recoilTime <= 0.015. AK47/M39 duel definitions use a practically
// infinite recoilTime, so the branch could select a solution forever without
// pulling the trigger. V260 must plan against real shot spread and must not have
// that impossible runtime gate.
const ricochetPlanner = source.slice(
    source.indexOf("indirectShot = chooseForbiddenIndirectShot({"),
    source.indexOf("if (indirectShot) {", source.indexOf("indirectShot = chooseForbiddenIndirectShot({")),
);
assert.ok(
    ricochetPlanner.includes("activeDef.shotSpread"),
    "forbidden ricochet planning must include authoritative weapon spread",
);
assert.ok(
    !ricochetPlanner.includes("spreadRadians: 0"),
    "forbidden ricochet planning must never assume zero spread",
);
assert.ok(
    !source.includes("currentWeapon.recoilTime <= 0.015"),
    "ricochet firing must not wait for impossible first-shot-accuracy recoil recovery",
);
assert.ok(
    !source.includes("Number(def.recoilTime ?? 0) * 1000"),
    "local tactical ricochet must not turn huge weapon recoilTime into an execution deadline",
);
assert.ok(
    !source.includes("spreadRadians: 0,"),
    "no ricochet planner may assume fictional zero-spread first-shot accuracy",
);
assert.ok(
    !source.includes("ricochetPrecisionStance"),
    "ricochet selection must not force the V257 stop-and-wait precision deadlock",
);

// Exact ricochet geometry remains strict, but a near-aligned continuously
// requested shot gets a bounded recovery instead of an infinite packet gate.
assert.equal(shouldDelayGunfire(0.0008, true, false, 0, true), true);
assert.equal(shouldDelayGunfire(0.0008, true, false, 160, true), false);
assert.equal(shouldDelayGunfire(0.001, true, false, 1000, true), true);

// The lower-level movement stabilizer still smooths ordinary navigation but can
// snap a proven emergency dodge immediately. smartBot must use that escape hatch
// for reactive bullet, explosive and proactive gun-line dodges.
const smoothed = stabilizeMovementDirection(
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    {
        timestamp: 1000,
        lockUntil: 1400,
        holdMs: 420,
        allowImmediate: false,
        turnRateRadiansPerSecond: 11,
        elapsedMs: 30,
    },
);
const emergency = stabilizeMovementDirection(
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    {
        timestamp: 1000,
        lockUntil: 1400,
        holdMs: 420,
        allowImmediate: true,
        turnRateRadiansPerSecond: 11,
        elapsedMs: 30,
    },
);
assert.ok(smoothed.direction.x > 0, "ordinary movement should remain smoothed");
assert.ok(emergency.direction.x < -0.99, "proven evasions must be executable immediately");
const emergencyCallCount = (source.match(/this\.moveDirection\([^;]+, true\);/g) ?? []).length;
assert.ok(emergencyCallCount >= 3, "all core forbidden emergency dodge branches must bypass smoothing");

// V257 packet-wall validation sometimes vetoed the exact crate/stone/barrel the
// tactical planner intentionally chose. V260 validates the first hit on the
// actual transmitted ray and explicitly permits the intended object itself.
assert.ok(
    source.includes("firstBlocker?.__id === tacticalObstacleId"),
    "packet wall safety must identify the intended tactical object by first actual hit",
);
assert.ok(
    source.includes('reason: "intentional-tactical-hit"'),
    "intentional tactical cover hits must be distinguishable from wall penetration",
);
assert.ok(
    source.indexOf("freshForbiddenTacticalId") < source.indexOf("this.currentTacticalObjectId && timestamp <= this.tacticalObjectLockUntil"),
    "fresh forbidden shot intent must take priority over an older tactical lock",
);

// V257 alternated special action aligning <-> holding every tick during a cook,
// creating ~135k phase records in the supplied duel log. Holding must remain a
// stable phase after the throwable has started.
assert.ok(
    source.includes('if (!action.throwPhase) {\n                this.setSpecialActionPhase(action, "aligning", timestamp, "equipped");'),
    "throwable cook must not reset its phase to aligning every tick",
);

console.log("V260 duel combat regression smoke test passed: ricochet fire, emergency dodge, tactical cover shots and throwable phase stability are protected.");
