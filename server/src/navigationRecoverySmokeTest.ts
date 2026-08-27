import assert from "assert";
import { colliderApproachPlan } from "./bot/interactionGeometry.ts";
import {
    type NavigationBlocker,
    planLocalSteering,
    planStuckRecovery,
} from "./bot/navigationController.ts";
import {
    canRunNavigationRecovery,
    hasDurableRecoveryProgress,
} from "./bot/resourcePursuit.ts";

const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

const frontBlocker: NavigationBlocker[] = [
    { id: 1, pos: { x: 4, y: 0 }, radius: 2.2 },
];
const first = planStuckRecovery(
    { x: 0, y: 0 },
    frontBlocker,
    {
        desiredDirection: { x: 1, y: 0 },
        attempt: 1,
        clearance: 0.9,
        bounds,
    },
);
assert.ok(Math.abs(first.direction.y) > 0.35, "a frontal blocker should produce a sidestep");
assert.ok(first.clearance > 2, "the selected sidestep must have usable clearance");

const corner: NavigationBlocker[] = [
    { id: 1, pos: { x: 53.2, y: 50 }, radius: 2.1 },
    { id: 2, pos: { x: 50, y: 53.1 }, radius: 2.1 },
];
const cornerPlan = planStuckRecovery(
    { x: 50, y: 50 },
    corner,
    {
        desiredDirection: { x: 1, y: 0 },
        attempt: 3,
        previousDirection: first.direction,
        clearance: 0.9,
        bounds,
    },
);
assert.ok(
    cornerPlan.direction.y < -0.15 || cornerPlan.direction.x < -0.15,
    "repeated recovery should escape the blocked corner rather than repeat the same push",
);

const repeated = planStuckRecovery(
    { x: 50, y: 50 },
    frontBlocker.map((blocker) => ({ ...blocker, pos: { x: blocker.pos.x + 50, y: blocker.pos.y + 50 } })),
    {
        desiredDirection: { x: 1, y: 0 },
        attempt: 4,
        previousDirection: first.direction,
        clearance: 0.9,
        bounds,
    },
);
assert.ok(
    repeated.direction.x < 0.8 || Math.sign(repeated.direction.y) !== Math.sign(first.direction.y),
    "later attempts should not select the exact same failed direction",
);

// The preferred corner around the first wall is occupied by a second fixture.
// Local steering must validate the complete blocker set and take the clear side.
const denseRoomPlan = planLocalSteering(
    { x: 0, y: 10 },
    { x: 14, y: 10 },
    [
        {
            id: 10,
            pos: { x: 5, y: 10 },
            radius: 2,
            collision: {
                type: 1,
                min: { x: 4, y: 9 },
                max: { x: 6, y: 11 },
            },
        },
        { id: 11, pos: { x: 2.3, y: 7.3 }, radius: 1.1 },
    ],
    { clearance: 0.85, preferredSide: 1, bounds },
);
assert.ok(
    denseRoomPlan.waypoint.y > 10,
    "a waypoint blocked by a second fixture must be rejected instead of causing side-to-side oscillation",
);

// A stuck crate recovery must steer to the reachable surface approach point,
// never the crate center (inside the collider). Steering to the center pushes
// the bot into the crate face and repeats recovery forever.
const cratePlan = colliderApproachPlan({
    // Collider coordinates are local to the object (centered crate).
    definition: { collision: { type: 0, pos: { x: 0, y: 0 }, rad: 2 } },
    objectPos: { x: 20, y: 20 },
    // Actor pressed against the crate face (stuck state from the recordings).
    actorPos: { x: 23.2, y: 20 },
    reach: 2.6,
});
assert.ok(cratePlan.canReach, "crate approach point must be reachable");
assert.ok(
    cratePlan.approachPoint.x > 20,
    "crate approach point must sit outside the collider on the actor side",
);
assert.ok(
    Math.hypot(
        cratePlan.approachPoint.x - 20,
        cratePlan.approachPoint.y - 20,
    ) > 2,
    "crate approach point must not be inside the crate collider",
);

// Survival movement is exactly where oscillation recovery is most important.
assert.equal(canRunNavigationRecovery("gas"), true);
assert.equal(canRunNavigationRecovery("airstrike"), true);
assert.equal(canRunNavigationRecovery("weapon-search"), true);
assert.equal(canRunNavigationRecovery("combat"), false);
assert.equal(canRunNavigationRecovery("heal"), false);

assert.equal(
    hasDurableRecoveryProgress({
        elapsedMs: 500,
        displacement: 3,
        startObjectiveDistance: 20,
        currentObjectiveDistance: 17,
    }),
    false,
    "a short probe must not clear recovery memory",
);
assert.equal(
    hasDurableRecoveryProgress({
        elapsedMs: 1500,
        displacement: 3,
        startObjectiveDistance: 20,
        currentObjectiveDistance: 20.4,
    }),
    false,
    "lateral ping-pong without objective progress must keep escalating",
);
assert.equal(
    hasDurableRecoveryProgress({
        elapsedMs: 1500,
        displacement: 3,
        startObjectiveDistance: 20,
        currentObjectiveDistance: 18.6,
    }),
    true,
    "sustained displacement toward the objective is a real recovery",
);
assert.equal(
    hasDurableRecoveryProgress({
        elapsedMs: 1500,
        displacement: 8,
        startObjectiveDistance: 20,
        currentObjectiveDistance: 21,
    }),
    true,
    "leaving the local trap area is durable even during a required detour",
);

console.log("Navigation recovery smoke test passed");
