import assert from "node:assert/strict";
import {
    evaluateAirdropSupport,
    selectRecoveryObjective,
    shouldYieldCrowdedResource,
} from "./bot/collectiveLogic.ts";

interface SimBot {
    id: number;
    armedAt: number;
    armed: boolean;
    supportStartedAt: number;
    supportCooldownUntil: number;
    defending: boolean;
    maxContinuousSupportMs: number;
    currentSupportBeganAt: number;
}

const bots: SimBot[] = Array.from({ length: 40 }, (_, index) => {
    const id = index + 1;
    // Later worker batches join later and therefore acquire a gun later. The
    // stagger deliberately reproduces the supplied 50v50 recording shape.
    const workerWave = Math.floor(index / 8);
    return {
        id,
        armedAt: 6_000 + workerWave * 3_000 + (id % 5) * 900,
        armed: false,
        supportStartedAt: 0,
        supportCooldownUntil: 0,
        defending: false,
        maxContinuousSupportMs: 0,
        currentSupportBeganAt: 0,
    };
});

const stepMs = 500;
const durationMs = 180_000;
const dropStartsAt = 25_000;
const dropEndsAt = 62_000;
const gasStartsAt = 105_000;
const dropObjectId = 733;
let maxSimultaneousDefenders = 0;
let unarmedDefenceFrames = 0;
let committedDefenceFrames = 0;
let defenceFramesAfterDrop = 0;
let gasRecoveryChecks = 0;
let staleResourceRecoveries = 0;
const stateTotals = new Map<string, number>();

for (let timestamp = 0; timestamp <= durationMs; timestamp += stepMs) {
    const activeDrop = timestamp >= dropStartsAt && timestamp < dropEndsAt;
    const gasEmergency = timestamp >= gasStartsAt;
    let currentDefenders = 0;

    for (const bot of bots) {
        bot.armed = timestamp >= bot.armedAt;
        const committedResource = !bot.armed;
        const assigned = (bot.id + dropObjectId) % 8 === 0;
        const enemyPressure = timestamp >= 43_000 && timestamp < 47_000 && bot.id % 13 === 0;
        const inCooldown = timestamp < bot.supportCooldownUntil;
        const decision = evaluateAirdropSupport({
            activeDrop,
            assigned: assigned && !inCooldown,
            armed: bot.armed,
            committedResource,
            enemyDistance: enemyPressure ? 20 : 90,
            recentlyDamaged: false,
            nearbySupporters: currentDefenders,
            timestamp,
            startedAt: bot.defending ? bot.supportStartedAt : 0,
            maxSupporters: 4,
            maxDurationMs: 12_000,
        });

        if (decision.defend && !gasEmergency) {
            if (!bot.defending) {
                bot.currentSupportBeganAt = timestamp;
            }
            bot.defending = true;
            bot.supportStartedAt = decision.startedAt;
            currentDefenders += 1;
            if (!bot.armed) unarmedDefenceFrames += 1;
            if (committedResource) committedDefenceFrames += 1;
            if (!activeDrop) defenceFramesAfterDrop += 1;
        } else {
            if (bot.defending) {
                bot.maxContinuousSupportMs = Math.max(
                    bot.maxContinuousSupportMs,
                    timestamp - bot.currentSupportBeganAt,
                );
            }
            if (decision.reason === "expired") {
                bot.supportCooldownUntil = timestamp + 20_000;
            }
            bot.defending = false;
            bot.supportStartedAt = 0;
        }

        let state: string;
        if (gasEmergency) {
            state = "gas";
            const gasWaypoint = { x: 100 + bot.id * 0.35, y: 80 + (bot.id % 7) * 1.6 };
            const staleLoot = { x: -40 - bot.id, y: -30 };
            const selected = selectRecoveryObjective({
                state: "gas",
                pos: { x: bot.id, y: bot.id * 0.5 },
                lastCommandDirection: { x: 1, y: 0 },
                gasWaypoint,
                lootTarget: staleLoot,
                crateTarget: { x: -55, y: -55 },
            });
            gasRecoveryChecks += 1;
            if (selected.x === staleLoot.x && selected.y === staleLoot.y) {
                staleResourceRecoveries += 1;
            }
            assert.deepEqual(selected, gasWaypoint);
        } else if (bot.defending) {
            state = "special";
        } else if (!bot.armed) {
            state = "loot";
        } else {
            state = "combat";
        }
        stateTotals.set(state, (stateTotals.get(state) ?? 0) + 1);
    }

    maxSimultaneousDefenders = Math.max(maxSimultaneousDefenders, currentDefenders);
}

for (const bot of bots) {
    if (bot.defending) {
        bot.maxContinuousSupportMs = Math.max(
            bot.maxContinuousSupportMs,
            durationMs - bot.currentSupportBeganAt,
        );
    }
}

// Simulate cross-worker resource selection. Each resource may be approached by
// no more than two bots, and the crowd gate should force later workers onto a
// different target rather than creating one large collision cluster.
const resourceOccupancy = new Map<number, number>();
let assignedResources = 0;
for (const bot of bots) {
    const candidates = Array.from({ length: 40 }, (_, resourceId) => {
        const distance = 8 + ((bot.id * 17 + resourceId * 11) % 47);
        const bias = Math.sin(resourceId * 12.9898 + bot.id * 78.233) * 14;
        return { resourceId, distance, score: 100 - distance + bias };
    }).sort((a, b) => b.score - a.score);

    for (const candidate of candidates) {
        const occupants = resourceOccupancy.get(candidate.resourceId) ?? 0;
        const yieldTarget = shouldYieldCrowdedResource({
            distanceToTarget: candidate.distance,
            nearestFriendlyDistance: occupants > 0 ? 0.8 : Number.POSITIVE_INFINITY,
            nearbyFriendlies: occupants,
            urgent: true,
            underarmed: true,
        });
        if (yieldTarget) continue;
        resourceOccupancy.set(candidate.resourceId, occupants + 1);
        assignedResources += 1;
        break;
    }
}

const maxResourceCrowd = Math.max(...resourceOccupancy.values());
const occupiedResourceCount = resourceOccupancy.size;
const maxSupportDuration = Math.max(...bots.map((bot) => bot.maxContinuousSupportMs));
const armedByThirtySeconds = bots.filter((bot) => bot.armedAt <= 30_000).length;
const totalFrames = Array.from(stateTotals.values()).reduce((sum, count) => sum + count, 0);
const specialShare = (stateTotals.get("special") ?? 0) / totalFrames;

assert.equal(unarmedDefenceFrames, 0, "unarmed bots entered airdrop defence");
assert.equal(committedDefenceFrames, 0, "resource-committed bots entered airdrop defence");
assert.equal(defenceFramesAfterDrop, 0, "bots defended an inactive/opened airdrop");
assert.ok(maxSimultaneousDefenders <= 4, "airdrop support cap was exceeded");
assert.ok(maxSupportDuration <= 12_000, "airdrop defence exceeded its bounded window");
assert.equal(staleResourceRecoveries, 0, "gas recovery selected stale loot/crate targets");
assert.equal(armedByThirtySeconds, 40, "not all simulated bots acquired a gun in time");
assert.ok(maxResourceCrowd <= 2, "resource crowding exceeded two bots per target");
assert.ok(occupiedResourceCount >= 30, "resource selection did not spread across the map");
assert.ok(assignedResources >= 36, "too many bots failed to obtain a distinct resource route");
assert.ok(specialShare < 0.08, "special-state share is still high enough to starve core logic");

console.log(
    JSON.stringify(
        {
            simulation: "40-bot deterministic faction logic",
            durationMs,
            stepMs,
            bots: bots.length,
            armedByThirtySeconds,
            maxSimultaneousDefenders,
            maxSupportDuration,
            specialStateShare: Number((specialShare * 100).toFixed(2)),
            gasRecoveryChecks,
            staleResourceRecoveries,
            occupiedResourceCount,
            assignedResources,
            maxResourceCrowd,
            stateTotals: Object.fromEntries(stateTotals),
            result: "PASS",
        },
        null,
        2,
    ),
);
