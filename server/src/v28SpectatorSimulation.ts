import assert from "assert";

import { IntentTier, type BotIntentCandidate } from "./bot/decisionBrain.ts";
import {
    chooseVisibleThreatInterrupt,
    filterSuppressedIntents,
    strategicIntentBackoffMs,
} from "./bot/spectatorSupervisor.ts";

interface SimulatedBotResult {
    id: number;
    armed: boolean;
    enemyDistance: number;
    recentlyDamagedMs: number;
    expected: string;
    actual: string;
    passed: boolean;
}

const results: SimulatedBotResult[] = [];
for (let id = 1; id <= 60; id += 1) {
    const armed = id % 5 !== 0;
    const recentlyDamagedMs = id % 4 === 0 ? 240 : 2_000;
    const enemyDistance = !armed ? 5.8 : recentlyDamagedMs < 900 ? 36 : 18 + (id % 7);
    const reactionReady = id % 3 !== 0;
    const decision = chooseVisibleThreatInterrupt({
        enemyVisible: true,
        enemyDistance,
        hasUsableGun: armed,
        reactionReady,
        millisecondsSinceDamage: recentlyDamagedMs,
        currentState: id % 2 === 0 ? "regroup" : "loot",
        pendingThrowableRelease: false,
        survivalEmergency: false,
    });
    const expected = !armed
        ? "evade-and-search"
        : recentlyDamagedMs < 900
          ? "counterfire"
          : reactionReady
            ? "combat"
            : "none";
    const actual = decision.response ?? "none";
    const passed = actual === expected;
    results.push({ id, armed, enemyDistance, recentlyDamagedMs, expected, actual, passed });
}
assert.equal(results.every((result) => result.passed), true);

const emergency = chooseVisibleThreatInterrupt({
    enemyVisible: true,
    enemyDistance: 3,
    hasUsableGun: true,
    reactionReady: true,
    millisecondsSinceDamage: 100,
    currentState: "airstrike",
    pendingThrowableRelease: false,
    survivalEmergency: true,
});
assert.equal(emergency.interrupt, false);

const suppressionChecks: Array<{ id: number; removed: boolean; combatKept: boolean; backoffMs: number }> = [];
for (let id = 1; id <= 60; id += 1) {
    const targetKey = `faction:bridgehead:${id % 8}`;
    const candidates: BotIntentCandidate[] = [
        {
            kind: "faction-order",
            state: "regroup",
            tier: IntentTier.strategic,
            utility: 600,
            targetKey,
        },
        {
            kind: "combat",
            state: "combat",
            tier: IntentTier.combat,
            utility: 720,
            targetKey: `enemy:${1_000 + id}`,
        },
    ];
    const backoffMs = strategicIntentBackoffMs(3 + (id % 4));
    const filtered = filterSuppressedIntents(
        candidates,
        new Map([[targetKey, 10_000 + backoffMs]]),
        10_000,
    );
    suppressionChecks.push({
        id,
        removed: !filtered.some((candidate) => candidate.targetKey === targetKey),
        combatKept: filtered.some((candidate) => candidate.kind === "combat"),
        backoffMs,
    });
}
assert.equal(suppressionChecks.every((result) => result.removed && result.combatKept), true);

const summary = {
    simulatedBots: results.length,
    visibleThreatResponsesPassed: results.filter((result) => result.passed).length,
    combatResponses: results.filter((result) => result.actual === "combat").length,
    counterfireResponses: results.filter((result) => result.actual === "counterfire").length,
    unarmedEvadeResponses: results.filter((result) => result.actual === "evade-and-search").length,
    survivalPriorityProtected: !emergency.interrupt,
    strategicTargetsSuppressed: suppressionChecks.filter((result) => result.removed).length,
    combatCandidatesPreserved: suppressionChecks.filter((result) => result.combatKept).length,
    minimumBackoffMs: Math.min(...suppressionChecks.map((result) => result.backoffMs)),
    maximumBackoffMs: Math.max(...suppressionChecks.map((result) => result.backoffMs)),
};

console.log(JSON.stringify(summary, null, 2));
