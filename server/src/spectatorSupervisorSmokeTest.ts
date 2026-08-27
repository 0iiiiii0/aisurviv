import assert from "assert";

import { IntentTier, type BotIntentCandidate } from "./bot/decisionBrain.ts";
import {
    chooseVisibleThreatInterrupt,
    filterSuppressedIntents,
    intentSuppressionKeys,
    isSuppressibleIntent,
    shouldRetainOccludedTarget,
    strategicIntentBackoffMs,
} from "./bot/spectatorSupervisor.ts";

const base = {
    enemyVisible: true,
    enemyDistance: 18,
    hasUsableGun: true,
    reactionReady: true,
    millisecondsSinceDamage: 10_000,
    currentState: "regroup" as const,
    pendingThrowableRelease: false,
    survivalEmergency: false,
};

const regroupInterrupt = chooseVisibleThreatInterrupt(base);
assert.equal(regroupInterrupt.interrupt, true);
assert.equal(regroupInterrupt.response, "combat");

const damagedInterrupt = chooseVisibleThreatInterrupt({
    ...base,
    enemyDistance: 39,
    millisecondsSinceDamage: 250,
    currentState: "loot",
});
assert.equal(damagedInterrupt.interrupt, true);
assert.equal(damagedInterrupt.response, "counterfire");

const unarmedInterrupt = chooseVisibleThreatInterrupt({
    ...base,
    enemyDistance: 5.5,
    hasUsableGun: false,
    reactionReady: false,
    currentState: "break-crate",
});
assert.equal(unarmedInterrupt.interrupt, true);
assert.equal(unarmedInterrupt.response, "evade-and-search");

assert.equal(
    chooseVisibleThreatInterrupt({ ...base, survivalEmergency: true }).interrupt,
    false,
);
assert.equal(
    chooseVisibleThreatInterrupt({ ...base, pendingThrowableRelease: true }).interrupt,
    false,
);
assert.equal(
    chooseVisibleThreatInterrupt({
        ...base,
        enemyDistance: 40,
        reactionReady: false,
        millisecondsSinceDamage: 10_000,
    }).interrupt,
    false,
);
assert.equal(
    chooseVisibleThreatInterrupt({
        ...base,
        currentState: "combat",
        enemyDistance: 4,
        millisecondsSinceDamage: 50,
    }).interrupt,
    false,
    "an active combat response must not be reset by its own supervisor",
);
assert.equal(
    chooseVisibleThreatInterrupt({
        ...base,
        currentState: "retreat",
        enemyDistance: 4,
        millisecondsSinceDamage: 50,
    }).interrupt,
    false,
    "a health-driven retreat must retain its movement policy",
);

const protectedHealing = chooseVisibleThreatInterrupt({
    ...base,
    currentState: "heal",
    enemyDistance: 10.9,
    healingBehindHardCover: true,
});
assert.equal(
    protectedHealing.interrupt,
    false,
    "valid hard cover must preserve an active healing action",
);
assert.equal(protectedHealing.reason, "protected-healing");

const exposedHealing = chooseVisibleThreatInterrupt({
    ...base,
    currentState: "heal",
    enemyDistance: 10.9,
    healingBehindHardCover: false,
});
assert.equal(
    exposedHealing.interrupt,
    true,
    "healing must still be interrupted after hard cover is lost",
);
assert.equal(exposedHealing.response, "combat");

const candidates: BotIntentCandidate[] = [
    {
        kind: "faction-order",
        state: "regroup",
        tier: IntentTier.strategic,
        utility: 500,
        targetKey: "faction:bridge:2",
    },
    {
        kind: "explore",
        state: "explore",
        tier: IntentTier.idle,
        utility: 10,
        targetKey: "explore:10:20",
    },
    {
        kind: "combat",
        state: "combat",
        tier: IntentTier.combat,
        utility: 700,
        targetKey: "enemy:7",
    },
];
assert.equal(isSuppressibleIntent(candidates[0]), true);
assert.equal(isSuppressibleIntent(candidates[2]), false);

const filtered = filterSuppressedIntents(
    candidates,
    new Map([["faction:bridge:2", 5_000]]),
    1_000,
);
assert.equal(filtered.some((candidate) => candidate.targetKey === "faction:bridge:2"), false);
assert.equal(filtered.some((candidate) => candidate.kind === "combat"), true);
const enemySearch: BotIntentCandidate = {
    kind: "enemy-search",
    state: "explore",
    tier: IntentTier.strategic,
    utility: 500,
    targetKey: "enemy-search:77:3",
};
assert.deepEqual(intentSuppressionKeys(enemySearch), [
    "enemy-search:77:3",
    "enemy-search:77",
]);
assert.equal(
    filterSuppressedIntents(
        [enemySearch],
        new Map([["enemy-search:77", 5_000]]),
        1_000,
    ).length,
    0,
    "a failed enemy sweep must stay suppressed across its step suffixes",
);
assert.equal(
    shouldRetainOccludedTarget({
        difficulty: "hard",
        currentTarget: true,
        sameLayer: true,
        memoryAgeMs: 500,
        rememberedPointOnScreen: true,
        proPeekActive: false,
    }),
    true,
);
assert.equal(
    shouldRetainOccludedTarget({
        difficulty: "normal",
        currentTarget: true,
        sameLayer: true,
        memoryAgeMs: 700,
        rememberedPointOnScreen: true,
        proPeekActive: false,
    }),
    false,
    "ordinary AI must not chase stale hidden coordinates",
);
assert.ok(strategicIntentBackoffMs(4) > strategicIntentBackoffMs(2));
assert.ok(strategicIntentBackoffMs(20) <= 24_000);

console.log("spectator supervisor smoke test passed");
