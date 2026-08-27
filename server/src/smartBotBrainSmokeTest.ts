import assert from "assert";

import {
    IntentTier,
    TacticalDecisionBrain,
    type BotIntentCandidate,
} from "./bot/decisionBrain.ts";
import { planLocalSteering, scoreIndoorDoorRoute } from "./bot/navigationController.ts";

const candidate = (
    kind: BotIntentCandidate["kind"],
    state: BotIntentCandidate["state"],
    tier: number,
    utility: number,
    extras: Partial<BotIntentCandidate> = {},
): BotIntentCandidate => ({ kind, state, tier, utility, ...extras });

const brain = new TacticalDecisionBrain({ switchMargin: 18 });

// No firearm: opening loot may beat ordinary visible-enemy combat.
let decision = brain.choose(
    [
        candidate("urgent-loot", "loot", IntentTier.combat, 1180, {
            targetKey: "loot:10",
            commitMs: 1000,
        }),
        candidate("combat", "combat", IntentTier.combat, 970, {
            targetKey: "enemy:20",
        }),
    ],
    1000,
);
assert.equal(decision.kind, "urgent-loot");

// A small same-tier score fluctuation must not cause loot/combat oscillation
// during the commitment window.
decision = brain.choose(
    [
        candidate("urgent-loot", "loot", IntentTier.combat, 1080, {
            targetKey: "loot:10",
            commitMs: 1000,
        }),
        candidate("combat", "combat", IntentTier.combat, 1090, {
            targetKey: "enemy:20",
        }),
    ],
    1200,
);
assert.equal(decision.kind, "urgent-loot");
assert.equal(decision.retained, true);

// Immediate ballistic danger is emergency-tier and interrupts the resource lock.
decision = brain.choose(
    [
        candidate("urgent-loot", "loot", IntentTier.combat, 1200, {
            targetKey: "loot:10",
        }),
        candidate("counterfire", "counterfire", IntentTier.emergency, 900, {
            targetKey: "trajectory:abc",
            critical: true,
        }),
    ],
    1300,
);
assert.equal(decision.kind, "counterfire");

// Ordinary combat must interrupt a lower resource-tier action.
brain.reset();
brain.choose(
    [candidate("loot", "loot", IntentTier.resource, 900, { targetKey: "loot:1" })],
    2000,
);
decision = brain.choose(
    [
        candidate("loot", "loot", IntentTier.resource, 950, { targetKey: "loot:1" }),
        candidate("combat", "combat", IntentTier.combat, 500, { targetKey: "enemy:2" }),
    ],
    2100,
);
assert.equal(decision.kind, "combat");

// Searching a recently lost visual contact must beat random roaming, while
// remaining interruptible by real combat and core equipment needs.
brain.reset();
decision = brain.choose(
    [
        candidate("enemy-search", "explore", IntentTier.strategic, 590, {
            targetKey: "enemy-search:33:2",
        }),
        candidate("explore", "explore", IntentTier.idle, 100),
    ],
    2400,
);
assert.equal(decision.kind, "enemy-search");
decision = brain.choose(
    [
        candidate("enemy-search", "explore", IntentTier.strategic, 610, {
            targetKey: "enemy-search:33:2",
        }),
        candidate("combat", "combat", IntentTier.combat, 500, {
            targetKey: "enemy:44",
        }),
    ],
    2500,
);
assert.equal(decision.kind, "combat");


// A committed resource action outranks low-priority special-role formation.
brain.reset();
decision = brain.choose(
    [
        candidate("break-crate", "break-crate", IntentTier.resource, 520, {
            targetKey: "crate:91",
            commitMs: 1200,
        }),
        candidate("special-role", "regroup", IntentTier.strategic, 610, {
            targetKey: "role:leader",
        }),
    ],
    3000,
);
assert.equal(decision.kind, "break-crate");

// Local steering: direct path remains direct.
let plan = planLocalSteering(
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    [],
    { preferredSide: 1 },
);
assert.equal(plan.blocked, false);
assert.ok(plan.direction.x > 0.99);
assert.ok(Math.abs(plan.direction.y) < 0.01);

// A usable closed door is approached rather than rejected as unreachable.
plan = planLocalSteering(
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    [{ id: 7, pos: { x: 4, y: 0 }, radius: 1, openableDoor: true }],
    { preferredSide: 1 },
);
assert.equal(plan.blocked, true);
assert.equal(plan.approachDoor, true);
assert.equal(plan.blockerId, 7);
assert.ok(plan.direction.x > 0.99);

// A solid obstacle creates a stable side waypoint instead of pushing straight
// into the collision circle.
plan = planLocalSteering(
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    [{ id: 8, pos: { x: 4, y: 0 }, radius: 1.2 }],
    {
        preferredSide: 1,
        bounds: { minX: -20, minY: -20, maxX: 20, maxY: 20 },
    },
);
assert.equal(plan.blocked, true);
assert.equal(plan.approachDoor, false);
assert.equal(plan.blockerId, 8);
assert.ok(plan.direction.y > 0.05);


// Indoor routing prefers a reachable doorway with a clear far side over a
// geometrically closer doorway visible through another wall.
const reachableDoor = scoreIndoorDoorRoute(
    { x: 0, y: 0 },
    { x: 12, y: 0 },
    {
        id: 21,
        pos: { x: 5, y: 1 },
        approachClear: true,
        targetSideClear: true,
    },
);
const throughWallDoor = scoreIndoorDoorRoute(
    { x: 0, y: 0 },
    { x: 12, y: 0 },
    {
        id: 22,
        pos: { x: 4, y: 0 },
        approachClear: false,
        targetSideClear: false,
    },
);
assert.ok(reachableDoor.score < throughWallDoor.score);

// Once open, an otherwise equivalent door gets a small stability bonus.
const closedDoor = scoreIndoorDoorRoute(
    { x: 0, y: 0 },
    { x: 12, y: 0 },
    { id: 23, pos: { x: 5, y: 0 }, approachClear: true, targetSideClear: true },
);
const openDoor = scoreIndoorDoorRoute(
    { x: 0, y: 0 },
    { x: 12, y: 0 },
    { id: 24, pos: { x: 5, y: 0 }, open: true, approachClear: true, targetSideClear: true },
);
assert.ok(openDoor.score < closedDoor.score);

console.log("smart bot brain smoke test passed");
