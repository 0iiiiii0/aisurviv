import assert from "node:assert/strict";
import { TeamMode } from "../../shared/gameConfig.ts";
import { resolveTeamPingWorldRoute } from "../../shared/teamPingRouting.ts";
import { resolveModeStrategy } from "./bot/modeStrategy.ts";
import { createModeAiSystem } from "./bot/modeSystems/index.ts";
import {
    evaluateRecoveryEscalation,
    evaluatePickupRetry,
    evaluateResourcePursuit,
    nextRepeatedRecoveryCount,
} from "./bot/resourcePursuit.ts";

const modes = [
    ["main", TeamMode.Solo, "solo:normal"],
    ["main", TeamMode.Duo, "duo:normal"],
    ["main", TeamMode.Squad, "squad:normal"],
    ["duel", TeamMode.Solo, "duel"],
    ["duel_ai", TeamMode.Solo, "duel"],
    ["faction", TeamMode.Squad, "faction:faction"],
    ["potato", TeamMode.Solo, "solo:event:potato"],
] as const;

const ids = new Set<string>();
for (const [mapName, teamMode, expected] of modes) {
    const system = createModeAiSystem(resolveModeStrategy(mapName, teamMode));
    assert.equal(system.policy.id, expected);
    ids.add(system.policy.id);
}
assert.equal(ids.size, modes.length - 1, "duel and duel_ai intentionally share the duel AI system; all other modes remain isolated");

// 绝密搜打撤 AI 自带满配双套装备：禁止搜刮/搜索（不捡地面、不开箱、不做
// 开场物资扫荡），只负责追杀真人并撤离；普通模式不受影响。
const secretProfile = resolveModeStrategy("extraction_secret", TeamMode.Solo);
assert.equal(secretProfile.lootEnabled, false, "secret-extraction AI must not loot loose items");
assert.equal(secretProfile.crateLootEnabled, false, "secret-extraction AI must not open crates/containers");
assert.equal(secretProfile.openingLootSeconds, 0, "secret-extraction AI must skip the opening loot sweep");
const normalProfile = resolveModeStrategy("main", TeamMode.Solo);
assert.equal(normalProfile.lootEnabled, true, "normal modes keep looting enabled");

assert.equal(resolveTeamPingWorldRoute({
    factionMode: true, activeGroupId: 1, senderGroupId: 2, activeTeamId: 1, senderTeamId: 1,
}), "faction");
assert.equal(resolveTeamPingWorldRoute({
    factionMode: false, activeGroupId: 1, senderGroupId: 2, activeTeamId: 1, senderTeamId: 1,
}), "none");
assert.equal(resolveTeamPingWorldRoute({
    factionMode: false, activeGroupId: 1, senderGroupId: 1, activeTeamId: 0, senderTeamId: 0,
}), "group");

const stalled = evaluateResourcePursuit({
    startedAt: 0, progressAt: 0, bestDistance: 5.2, distance: 5.1,
    timestamp: 3000, commitmentMs: 6500, progressTimeoutMs: 2100,
});
assert.equal(stalled.expired, true);
assert.equal(stalled.reason, "no-distance-progress");
const progressed = evaluateResourcePursuit({
    startedAt: 0, progressAt: 0, bestDistance: 5.2, distance: 4.2,
    timestamp: 1800, commitmentMs: 6500, progressTimeoutMs: 2100,
});
assert.equal(progressed.expired, false);
const interacting = evaluateResourcePursuit({
    startedAt: 1_000,
    progressAt: 1_000,
    bestDistance: 3.2,
    distance: 3.2,
    timestamp: 20_000,
    commitmentMs: 9_000,
    progressTimeoutMs: 2_600,
    engaged: true,
});
assert.equal(
    interacting.expired,
    false,
    "arrival at a legal interaction perimeter must not be mistaken for failed path progress",
);
assert.equal(interacting.progressAt, 20_000);
assert.equal(progressed.progressed, true);
assert.equal(evaluatePickupRetry({
    attemptCount: 7, retryLimit: 8, lastAttemptAt: 1_000, timestamp: 1_071,
}), "attempt");
assert.equal(evaluatePickupRetry({
    attemptCount: 8, retryLimit: 8, lastAttemptAt: 1_000, timestamp: 1_071,
}), "wait", "an exhausted pickup must stop refreshing its acknowledgement timer");
assert.equal(evaluatePickupRetry({
    attemptCount: 8, retryLimit: 8, lastAttemptAt: 1_000, timestamp: 1_650,
}), "abandon", "unacknowledged loot must be abandoned after the fixed grace window");
assert.equal(nextRepeatedRecoveryCount({
    targetKey: "loot:1", previousTargetKey: "loot:1", previousCount: 1,
    timestamp: 3500, previousAt: 1000,
}), 2);
assert.deepEqual(
    evaluateRecoveryEscalation({
        targetKey: "enemy:2",
        previousTargetKey: "loot:1",
        previousCount: 5,
        currentLevel: 5,
        timestamp: 3_500,
        previousAt: 3_000,
    }),
    { repeated: false, count: 1, level: 1 },
    "a new route must not inherit level-five recovery from an unrelated target",
);
assert.deepEqual(
    evaluateRecoveryEscalation({
        targetKey: "enemy:2",
        previousTargetKey: "enemy:2",
        previousCount: 2,
        currentLevel: 2,
        timestamp: 3_500,
        previousAt: 3_000,
    }),
    { repeated: true, count: 3, level: 3 },
);

console.log("mode isolation smoke test passed");
