import assert from "node:assert/strict";

import { IntentTier, type BotIntentCandidate } from "./bot/decisionBrain.ts";
import { updateGasEscapeLatch } from "./bot/gasEscape.ts";
import { planLocalSteering } from "./bot/navigationController.ts";
import {
    evaluateRecoveryEscalation,
    evaluateResourcePursuit,
} from "./bot/resourcePursuit.ts";
import {
    chooseVisibleThreatInterrupt,
    filterSuppressedIntents,
    shouldRetainOccludedTarget,
} from "./bot/spectatorSupervisor.ts";

// Replay symptom: a bot entered a new combat route while the previous unrelated
// route had already reached recovery level five.
const newCombatRoute = evaluateRecoveryEscalation({
    targetKey: "enemy:3794",
    previousTargetKey: "explore:261:463",
    previousCount: 5,
    currentLevel: 5,
    timestamp: 20_000,
    previousAt: 19_500,
});
assert.deepEqual(newCombatRoute, { repeated: false, count: 1, level: 1 });

// Replay symptom: a legal crate interaction perimeter (roughly 3 units) was
// abandoned because center-to-center distance stopped decreasing.
const reachedCrate = evaluateResourcePursuit({
    startedAt: 1_000,
    progressAt: 3_000,
    bestDistance: 3.1,
    distance: 3.1,
    timestamp: 15_000,
    commitmentMs: 9_000,
    progressTimeoutMs: 2_600,
    engaged: true,
});
assert.equal(reachedCrate.expired, false);
assert.equal(reachedCrate.progressAt, 15_000);

// Replay symptom: current-circle danger alternated safe/danger at sub-unit
// boundary movement. The latch must survive both the minimum hold and shallow
// re-entry, then release only in the deeper band.
let currentGasLatch = updateGasEscapeLatch({
    active: false,
    holdUntil: 0,
    timestamp: 1_000,
    trigger: true,
    releaseSafe: false,
    minimumHoldMs: 1_100,
    retryHoldMs: 420,
});
currentGasLatch = updateGasEscapeLatch({
    ...currentGasLatch,
    timestamp: 2_150,
    trigger: false,
    releaseSafe: false,
    minimumHoldMs: 1_100,
    retryHoldMs: 420,
});
assert.equal(currentGasLatch.active, true);
currentGasLatch = updateGasEscapeLatch({
    ...currentGasLatch,
    timestamp: currentGasLatch.holdUntil + 1,
    trigger: false,
    releaseSafe: true,
    minimumHoldMs: 1_100,
    retryHoldMs: 420,
});
assert.equal(currentGasLatch.active, false);

// Replay symptom: the visible-threat supervisor reset a combat response on
// every tick instead of interrupting voluntary work only.
const activeCombat = chooseVisibleThreatInterrupt({
    enemyVisible: true,
    enemyDistance: 12,
    hasUsableGun: true,
    usableWeaponRange: 40,
    reactionReady: true,
    millisecondsSinceDamage: 80,
    currentState: "combat",
    pendingThrowableRelease: false,
    survivalEmergency: false,
});
assert.equal(activeCombat.interrupt, false);

// A doorway/tree-edge occlusion retains only the last confirmed point briefly.
assert.equal(
    shouldRetainOccludedTarget({
        difficulty: "hard",
        currentTarget: true,
        sameLayer: true,
        memoryAgeMs: 480,
        rememberedPointOnScreen: true,
        proPeekActive: false,
    }),
    true,
);

// Enemy-search step suffixes must not bypass the backoff for the same enemy.
const enemySearch: BotIntentCandidate = {
    kind: "enemy-search",
    state: "explore",
    tier: IntentTier.strategic,
    utility: 560,
    targetKey: "enemy-search:3794:4",
};
assert.equal(
    filterSuppressedIntents(
        [enemySearch],
        new Map([["enemy-search:3794", 30_000]]),
        20_000,
    ).length,
    0,
);

// The combat direction now receives the same local obstacle detour used by
// regular exploration/resource movement.
const combatDetour = planLocalSteering(
    { x: 0, y: 0 },
    { x: 9, y: 0 },
    [{ id: 44, pos: { x: 4, y: 0 }, radius: 1.8 }],
    { clearance: 1, preferredSide: 1 },
);
assert.equal(combatDetour.blocked, true);
assert.ok(Math.abs(combatDetour.direction.y) > 0.2);

console.log(
    "V47 regular-mode replay recovery smoke test passed: route escalation, " +
        "resource arrival, gas hysteresis, combat continuity, enemy search backoff, and local detours.",
);
