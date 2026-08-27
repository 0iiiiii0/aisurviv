import assert from "assert";
import {
    evaluateGasRotationDeadline,
    isInsideGasCircle,
    selectGasEscapeTarget,
    updateGasEscapeLatch,
} from "./bot/gasEscape.ts";

const armedDeadline = evaluateGasRotationDeadline({
    phase: "mid",
    remainingSeconds: 10,
    travelSeconds: 1,
    armed: true,
    factionMode: true,
    newlyJoined: true,
    recentlyStuck: false,
    moving: false,
    gasT: 0.1,
    staggerSeed: 4,
});
const unarmedDeadline = evaluateGasRotationDeadline({
    phase: "mid",
    remainingSeconds: 10,
    travelSeconds: 1,
    armed: false,
    factionMode: true,
    newlyJoined: true,
    recentlyStuck: false,
    moving: false,
    gasT: 0.1,
    staggerSeed: 4,
});
assert.equal(armedDeadline.trigger, false);
assert.equal(unarmedDeadline.trigger, true);
assert(
    unarmedDeadline.deadlineBuffer > armedDeadline.deadlineBuffer,
    "unarmed bots must rotate earlier instead of receiving extra looting grace",
);
assert.equal(
    evaluateGasRotationDeadline({
        phase: "mid",
        remainingSeconds: 30,
        travelSeconds: 1,
        armed: true,
        factionMode: false,
        newlyJoined: false,
        recentlyStuck: false,
        moving: true,
        gasT: 0.24,
    }).hardMovingDeadline,
    true,
);

const current = { center: { x: 100, y: 100 }, radius: 60 };
const future = { center: { x: 125, y: 100 }, radius: 34 };
const myPos = { x: 166, y: 100 };

const target = selectGasEscapeTarget({
    myPos,
    current,
    future,
    phase: "mid",
    urgent: false,
    mapWidth: 220,
    mapHeight: 220,
    pathPenalty: (point) => (point.y < 98 ? 2 : 0),
});
assert.equal(isInsideGasCircle(target, current, "mid"), true);
assert.equal(isInsideGasCircle(target, future, "mid", 3), true);
assert(target.y >= 98, "blocked lower route must not be selected");

const urgent = selectGasEscapeTarget({
    myPos,
    current,
    future,
    phase: "late",
    urgent: true,
    mapWidth: 220,
    mapHeight: 220,
    pathPenalty: () => 0,
});
assert.equal(isInsideGasCircle(urgent, current, "late"), true);
assert(distance(myPos, urgent) < distance(myPos, current.center));

const laneA = selectGasEscapeTarget({
    myPos,
    current,
    future,
    phase: "mid",
    urgent: false,
    mapWidth: 220,
    mapHeight: 220,
    spreadSeed: 1,
    pathPenalty: () => 0,
});
const laneB = selectGasEscapeTarget({
    myPos,
    current,
    future,
    phase: "mid",
    urgent: false,
    mapWidth: 220,
    mapHeight: 220,
    spreadSeed: 8,
    pathPenalty: () => 0,
});
assert(
    distance(laneA, laneB) > 2,
    "different worker-global bot seeds must produce separate gas rotation lanes",
);

let latch = updateGasEscapeLatch({
    active: false,
    holdUntil: 0,
    timestamp: 1000,
    trigger: true,
    releaseSafe: false,
});
assert.equal(latch.active, true);
assert.equal(latch.holdUntil, 2800);
latch = updateGasEscapeLatch({
    ...latch,
    timestamp: 1500,
    trigger: false,
    releaseSafe: true,
});
assert.equal(latch.active, true, "future-circle escape must not release inside its minimum hold");
latch = updateGasEscapeLatch({
    ...latch,
    timestamp: 2900,
    trigger: false,
    releaseSafe: false,
});
assert.equal(latch.active, true, "boundary contact must extend the escape latch");
latch = updateGasEscapeLatch({
    ...latch,
    timestamp: latch.holdUntil + 1,
    trigger: false,
    releaseSafe: true,
});
assert.equal(latch.active, false, "the latch releases only after reaching the deeper safe band");

console.log("Gas escape smoke test passed: current/future-circle targeting, obstacle alternatives, urgent shortest-route selection and boundary hysteresis, and per-bot rotation lanes.");

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}
