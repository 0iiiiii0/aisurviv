import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { TeamMode } from "../../shared/gameConfig.ts";
import { resolveTeamPingWorldRoute } from "../../shared/teamPingRouting.ts";
import { resolveModeStrategy } from "./bot/modeStrategy.ts";
import { createModeAiSystem } from "./bot/modeSystems/index.ts";
import { evaluateResourcePursuit, nextRepeatedRecoveryCount } from "./bot/resourcePursuit.ts";
import { FactionCoordinator } from "./bot/factionStrategy.ts";

interface SimBot {
    id: number;
    target: number;
    distance: number;
    bestDistance: number;
    startedAt: number;
    progressAt: number;
    recoveries: number;
    abandoned: number;
    acquiredAt: number | null;
}

const scenarios = [
    { name: "solo", map: "main", team: TeamMode.Solo, bots: 15 },
    { name: "duo", map: "main", team: TeamMode.Duo, bots: 20 },
    { name: "squad", map: "main", team: TeamMode.Squad, bots: 20 },
    { name: "duel", map: "duel", team: TeamMode.Solo, bots: 1 },
    { name: "faction", map: "faction", team: TeamMode.Squad, bots: 40 },
    { name: "potato", map: "potato", team: TeamMode.Solo, bots: 15 },
] as const;

const report: Record<string, unknown> = {
    version: 26,
    simulatedStepMs: 500,
    scenarios: {},
};

for (const scenario of scenarios) {
    const profile = resolveModeStrategy(scenario.map, scenario.team);
    const system = createModeAiSystem(profile);
    if (profile.kind === "duel") {
        (report.scenarios as Record<string, unknown>)[scenario.name] = {
            system: system.policy.id,
            bots: scenario.bots,
            fixedLoadout: true,
            lootAttempts: 0,
            passed: system.policy.resourceCommitmentMs("loot", true) === 0,
        };
        continue;
    }

    const targetCount = scenario.bots * 2;
    const bots: SimBot[] = Array.from({ length: scenario.bots }, (_, index) => ({
        id: index + 1,
        target: (system.policy.formationSlot(index + 1, scenario.name === "faction" ? 1 : 0) * 3 + index) % targetCount,
        distance: 8 + (index % 5),
        bestDistance: 8 + (index % 5),
        startedAt: 0,
        progressAt: 0,
        recoveries: 0,
        abandoned: 0,
        acquiredAt: null,
    }));
    const unreachable = new Set<number>(
        Array.from({ length: Math.max(1, Math.floor(targetCount / 7)) }, (_, i) => i * 7),
    );
    let peakConcentration = 0;
    let expiredUnreachable = 0;

    for (let timestamp = 0; timestamp <= 30_000; timestamp += 500) {
        const concentration = new Map<number, number>();
        for (const bot of bots) {
            if (bot.acquiredAt !== null) continue;
            concentration.set(bot.target, (concentration.get(bot.target) ?? 0) + 1);
            const stuck = unreachable.has(bot.target);
            bot.distance = stuck
                ? bot.bestDistance + (((timestamp / 500 + bot.id) % 2 === 0) ? 0.08 : -0.08)
                : Math.max(0.45, bot.distance - 0.72);
            const evaluation = evaluateResourcePursuit({
                startedAt: bot.startedAt,
                progressAt: bot.progressAt,
                bestDistance: bot.bestDistance,
                distance: bot.distance,
                timestamp,
                commitmentMs: system.policy.resourceCommitmentMs("loot", true),
                progressTimeoutMs: system.policy.resourceProgressTimeoutMs("loot", true),
            });
            bot.bestDistance = evaluation.bestDistance;
            bot.progressAt = evaluation.progressAt;
            if (stuck && timestamp > 0 && timestamp % 1000 === 0) {
                bot.recoveries = nextRepeatedRecoveryCount({
                    targetKey: `loot:${bot.target}`,
                    previousTargetKey: `loot:${bot.target}`,
                    previousCount: bot.recoveries,
                    timestamp,
                    previousAt: timestamp - 1000,
                });
            }
            if (evaluation.expired || bot.recoveries >= system.policy.repeatedRecoveryLimit) {
                if (stuck) expiredUnreachable += 1;
                bot.abandoned += 1;
                bot.target = (bot.target + bot.id + 1) % targetCount;
                while (unreachable.has(bot.target)) bot.target = (bot.target + 1) % targetCount;
                bot.distance = 7 + (bot.id % 4);
                bot.bestDistance = bot.distance;
                bot.startedAt = timestamp;
                bot.progressAt = timestamp;
                bot.recoveries = 0;
                continue;
            }
            if (bot.distance <= 0.8) bot.acquiredAt = timestamp;
        }
        peakConcentration = Math.max(peakConcentration, ...concentration.values(), 0);
    }

    const acquired = bots.filter((bot) => bot.acquiredAt !== null).length;
    const longestAcquire = Math.max(...bots.map((bot) => bot.acquiredAt ?? 30_001));
    assert.equal(acquired, scenario.bots, `${scenario.name}: every bot should obtain a resource`);
    assert.ok(longestAcquire <= 30_000, `${scenario.name}: acquisition must finish within 30s`);
    assert.ok(expiredUnreachable > 0, `${scenario.name}: unreachable resources must be abandoned`);
    (report.scenarios as Record<string, unknown>)[scenario.name] = {
        system: system.policy.id,
        bots: scenario.bots,
        acquired,
        longestAcquireMs: longestAcquire,
        unreachableTargetsAbandoned: expiredUnreachable,
        totalAbandons: bots.reduce((sum, bot) => sum + bot.abandoned, 0),
        peakInitialTargetConcentration: peakConcentration,
        commitmentMs: system.policy.resourceCommitmentMs("loot", true),
        noProgressTimeoutMs: system.policy.resourceProgressTimeoutMs("loot", true),
        passed: true,
    };
}

const faction = new FactionCoordinator();
faction.reportAmmoNeed({
    key: "human:9001:9mm",
    requesterBotId: 0,
    requesterPlayerId: 9001,
    teamId: 1,
    ammoType: "9mm",
    pos: { x: 20, y: 20 },
    human: true,
    firstObservedAt: 0,
    updatedAt: 0,
});
const share = faction.claimAmmoShare({
    teamId: 1,
    donorBotId: 6,
    donorPos: { x: 24, y: 20 },
    availableAmmoTypes: new Set(["9mm"]),
    timestamp: 6500,
    allowMultipleHumanDonors: false,
    maxDistance: 58,
});
assert.ok(share && share.human && share.requesterPlayerId === 9001);
const giftRoute = resolveTeamPingWorldRoute({
    factionMode: true,
    activeGroupId: 1,
    senderGroupId: 9,
    activeTeamId: 1,
    senderTeamId: 1,
});
assert.equal(giftRoute, "faction");
report.ammoSharing = {
    humanRequestClaimedAfterMs: 6500,
    recipientPlayerId: share?.requesterPlayerId,
    crossGroupGiftWorldRoute: giftRoute,
    passed: true,
};

const out = join(process.cwd(), "V26_MULTI_MODE_SIMULATION.json");
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`simulation written to ${out}`);
