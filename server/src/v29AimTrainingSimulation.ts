import assert from "assert";
import {
    AIM_TRAINING_BOOST_LEVELS,
    AIM_TRAINING_RETURN_IDLE_SECONDS,
    aimTrainingAccuracy,
    aimTrainingCatalog,
    aimTrainingReturnDecision,
    aimTrainingSpeedBonusPercent,
    healthAfterTrainingDamage,
    normalizeAimTrainingSettings,
} from "./aimTraining.ts";

const activeFireDecision = aimTrainingReturnDecision({
    targetPos: { x: 120, y: 85 },
    traineePos: { x: 40, y: 50 },
    configuredDistance: 60,
    idleSeconds: AIM_TRAINING_RETURN_IDLE_SECONDS - 0.01,
    wasReturning: false,
    minX: 18,
    maxX: 202,
    minY: 24,
    maxY: 88,
});
assert.equal(activeFireDecision.returning, false, "the target must keep dodging during active fire");

const idleReturnDecision = aimTrainingReturnDecision({
    targetPos: { x: 120, y: 85 },
    traineePos: { x: 40, y: 50 },
    configuredDistance: 60,
    idleSeconds: AIM_TRAINING_RETURN_IDLE_SECONDS,
    wasReturning: false,
    minX: 18,
    maxX: 202,
    minY: 24,
    maxY: 88,
});
assert.equal(idleReturnDecision.returning, true, "an idle displaced target must return");
assert(idleReturnDecision.direction);
assert(idleReturnDecision.direction.x < 0);
assert(idleReturnDecision.direction.y < 0);

const continueReturnDecision = aimTrainingReturnDecision({
    targetPos: { x: 106, y: 53 },
    traineePos: { x: 40, y: 50 },
    configuredDistance: 60,
    idleSeconds: 2,
    wasReturning: true,
    minX: 18,
    maxX: 202,
    minY: 24,
    maxY: 88,
});
assert.equal(
    continueReturnDecision.returning,
    true,
    "return hysteresis must carry the target inside the outer leash",
);

const settledDecision = aimTrainingReturnDecision({
    targetPos: { x: 100.5, y: 50.4 },
    traineePos: { x: 40, y: 50 },
    configuredDistance: 60,
    idleSeconds: 2,
    wasReturning: true,
    minX: 18,
    maxX: 202,
    minY: 24,
    maxY: 88,
});
assert.equal(settledDecision.returning, false, "the target must resume normal movement after returning");

const catalog = aimTrainingCatalog();
const simulations = [] as Array<Record<string, unknown>>;
for (const boost of AIM_TRAINING_BOOST_LEVELS) {
    const speedBonusPercent = aimTrainingSpeedBonusPercent(boost);
    const expected = boost >= 50 ? 15.416666666666668 : 0;
    assert.ok(Math.abs(speedBonusPercent - expected) < 0.0001);
    simulations.push({ boost, speedBonusPercent });
}

for (const distance of catalog.distances) {
    const normalized = normalizeAimTrainingSettings({ distance });
    assert.equal(normalized.distance, distance);
}

let targetHealth = 100;
let shots = 0;
let hits = 0;
let damage = 0;
for (let i = 0; i < 1000; i++) {
    shots++;
    if (i % 5 !== 0) {
        hits++;
        const dealt = 13.5 + (i % 7) * 0.25;
        damage += dealt;
        targetHealth = healthAfterTrainingDamage(true, targetHealth, dealt);
        assert.equal(targetHealth, 100, "training target health must remain full");
    }
}
assert.equal(shots, 1000);
assert.equal(hits, 800);
assert.equal(aimTrainingAccuracy(shots, hits), 80);
assert.ok(damage > 10000);

const result = {
    targets: 1,
    simulatedShots: shots,
    simulatedHits: hits,
    accuracy: aimTrainingAccuracy(shots, hits),
    damage: Number(damage.toFixed(1)),
    targetFinalHealth: targetHealth,
    boostLevels: simulations,
    selectableDistances: catalog.distances,
    infiniteHealthAssertions: hits,
};
console.log(JSON.stringify(result, null, 2));
console.log("v29 aim training simulation passed");
