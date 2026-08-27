import assert from "assert";
import { aimTrainingTargetReady, waitForAimTrainingTarget } from "./aimTraining.ts";
import { assessCoverProtection } from "./bot/coverPreservation.ts";
import {
    evaluateForbiddenShotPath,
    type ForbiddenObstacleSnapshot,
} from "./bot/forbiddenCombat.ts";

const protective = assessCoverProtection({
    botPos: { x: 0, y: 0 },
    enemyPos: { x: 22, y: 0 },
    coverPos: { x: 4, y: 0 },
    coverRadius: 1.8,
});
assert.equal(protective.protectsBot, true);
assert.equal(protective.reason, "bot-side-cover");

const enemyOwned = assessCoverProtection({
    botPos: { x: 0, y: 0 },
    enemyPos: { x: 22, y: 0 },
    coverPos: { x: 18, y: 0 },
    coverRadius: 1.8,
});
assert.equal(enemyOwned.protectsBot, false);

const explicitlySelected = assessCoverProtection({
    botPos: { x: 0, y: 0 },
    enemyPos: { x: 22, y: 0 },
    coverPos: { x: 10, y: 0 },
    coverRadius: 1.4,
    currentCover: true,
});
assert.equal(explicitlySelected.protectsBot, true);
assert.equal(explicitlySelected.reason, "current-cover");

function obstacle(id: number, x: number): ForbiddenObstacleSnapshot {
    return {
        id,
        type: "wood_wall",
        pos: { x, y: 0 },
        layer: 0,
        height: 2,
        health: 20,
        maxHealth: 100,
        healthT: 0.2,
        dead: false,
        collidable: true,
        destructible: true,
        armorPlated: false,
        stonePlated: false,
        explosionType: "",
        explosionRadius: 0,
        collider: { type: 0, pos: { x, y: 0 }, rad: 1.8 },
    };
}

const protectedDecision = evaluateForbiddenShotPath({
    from: { x: 0, y: 0 },
    to: { x: 22, y: 0 },
    layer: 0,
    obstacles: [obstacle(1, 4)],
    bulletDamage: 40,
    obstacleDamage: 1,
    armorPiercing: false,
    stonePiercing: false,
    enemyPos: { x: 22, y: 0 },
    enemyHealth: 100,
    enemyHealing: false,
    enemyUsingCover: true,
    targetDistance: 22,
});
assert.equal(protectedDecision.kind, "hold");

const enemyCoverDecision = evaluateForbiddenShotPath({
    from: { x: 0, y: 0 },
    to: { x: 22, y: 0 },
    layer: 0,
    obstacles: [obstacle(2, 18)],
    bulletDamage: 40,
    obstacleDamage: 1,
    armorPiercing: false,
    stonePiercing: false,
    enemyPos: { x: 22, y: 0 },
    enemyHealth: 100,
    enemyHealing: false,
    enemyUsingCover: true,
    targetDistance: 22,
});
assert.equal(enemyCoverDecision.kind, "destroy");

assert.equal(
    aimTrainingTargetReady({ aiPlayerCount: 1, serverBotCount: 1, stopped: false }),
    true,
);
assert.equal(
    aimTrainingTargetReady({ aiPlayerCount: 0, serverBotCount: 0, stopped: false }),
    false,
);
assert.equal(
    aimTrainingTargetReady({ aiPlayerCount: 1, serverBotCount: 1, stopped: true }),
    false,
);

let readinessPolls = 0;
waitForAimTrainingTarget(
    () => {
        readinessPolls += 1;
        return readinessPolls >= 3
            ? { aiPlayerCount: 1, serverBotCount: 1, stopped: false }
            : { aiPlayerCount: 0, serverBotCount: 0, stopped: false };
    },
    100,
    1,
).then((ready) => {
    assert.equal(ready, true);
    assert.ok(readinessPolls >= 3);
    console.log("v31 aim training and cover preservation smoke test passed");
});
