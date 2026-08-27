import assert from "assert";
import fs from "fs";
import path from "path";
import { util } from "../../shared/utils/util.ts";
import {
    evaluateCrossFloorShot,
    type StairFireRegion,
} from "./bot/crossFloorFireSafety.ts";
import {
    BallisticInferenceEngine,
    chooseGunfireSafetyTarget,
    estimateShooterSearchPoint,
    pointInsideViewport,
    reconstructObservedBulletRange,
    type BulletObservation,
    type ViewportBounds,
} from "./bot/combatIntelligence.ts";
import {
    botLayersInteract,
    chooseStairTraversal,
    shouldFinishLockedStairCrossing,
    stairLockDeadline,
} from "./bot/stairNavigation.ts";
import { SquadCoordinator } from "./bot/smartBotSupport.ts";

const stair: StairFireRegion = {
    structureId: 100,
    stairIndex: 0,
    min: { x: -2, y: -3 },
    max: { x: 2, y: 3 },
    downDir: { x: 0, y: 1 },
};

const descendApproach = chooseStairTraversal({
    position: { x: 0, y: -10 },
    currentLayer: 0,
    target: { x: 0, y: 10 },
    targetLayer: 1,
    stairs: [stair],
    playerRadius: 0.72,
});
assert(descendApproach);
assert.equal(descendApproach.phase, "approach");
assert.ok(descendApproach.point.y < stair.min.y, "ground entry is opposite downDir");

const descendCross = chooseStairTraversal({
    position: { x: 0, y: -2 },
    currentLayer: 2,
    target: { x: 0, y: 10 },
    targetLayer: 1,
    stairs: [stair],
    playerRadius: 0.72,
});
assert(descendCross);
assert.equal(descendCross.phase, "cross");
assert.ok(descendCross.point.y > stair.max.y, "layer 2 must keep crossing toward bunker");

const descendTargetSide = chooseStairTraversal({
    position: { x: 0, y: 2 },
    currentLayer: 3,
    target: { x: 0, y: 10 },
    targetLayer: 1,
    stairs: [stair],
});
assert(descendTargetSide);
assert.equal(descendTargetSide.phase, "cross");
assert.ok(
    descendTargetSide.point.y > stair.max.y,
    "layer 3 inside the connector must finish descending before stopping",
);

const ascendApproach = chooseStairTraversal({
    position: { x: 0, y: 10 },
    currentLayer: 1,
    target: { x: 0, y: -10 },
    targetLayer: 0,
    stairs: [stair],
});
assert(ascendApproach);
assert.ok(ascendApproach.point.y > stair.max.y, "bunker entry is along downDir");
const ascendTargetSide = chooseStairTraversal({
    position: { x: 0, y: -2 },
    currentLayer: 2,
    target: { x: 0, y: -10 },
    targetLayer: 0,
    stairs: [stair],
});
assert(ascendTargetSide);
assert.equal(ascendTargetSide.phase, "cross");
assert.ok(
    ascendTargetSide.point.y < stair.min.y,
    "layer 2 inside the connector must finish ascending before stopping",
);
const alternateStair: StairFireRegion = {
    ...stair,
    structureId: 200,
    min: { x: 28, y: -3 },
    max: { x: 32, y: 3 },
};
assert.equal(
    chooseStairTraversal({
        position: { x: 30, y: -2 },
        currentLayer: 2,
        target: { x: 30, y: 12 },
        targetLayer: 1,
        stairs: [stair, alternateStair],
    })?.structureId,
    200,
    "a stair-layer player must use the connector whose AABB actually contains it",
);
const lockedConnector = chooseStairTraversal({
    position: { x: 30, y: -2 },
    currentLayer: 2,
    target: { x: 30, y: 12 },
    targetLayer: 1,
    stairs: [stair, alternateStair],
    preferredConnector: { structureId: 100, stairIndex: 0 },
});
assert.equal(
    lockedConnector?.structureId,
    100,
    "an active crossing must not switch to a newly-nearer connector",
);
assert.equal(
    chooseStairTraversal({
        position: { x: 0, y: -10 },
        currentLayer: 0,
        target: { x: 0, y: 0 },
        targetLayer: 2,
        stairs: [stair],
    }),
    null,
    "ground and its stair half do not require a base-floor transition",
);
assert.equal(botLayersInteract(0, 2), true);
assert.equal(botLayersInteract(1, 3), true);
assert.equal(botLayersInteract(2, 3), true);
assert.equal(botLayersInteract(0, 1), false);
assert.equal(util.toStairsLayer(0), 2);
assert.equal(util.toStairsLayer(1), 3);
assert.equal(util.toStairsLayer(2), 2);
assert.equal(util.toStairsLayer(3), 3);
assert.equal(stairLockDeadline(undefined, 1000), 13_000);
assert.equal(
    stairLockDeadline(13_000, 4000),
    13_000,
    "an active connector deadline must not slide forward on every think",
);
assert.equal(
    stairLockDeadline(13_000, 14_000),
    13_000,
    "an expired lock remains expired until a genuinely new route is created",
);
assert.equal(shouldFinishLockedStairCrossing(3, 13_000, 16_500), true);
assert.equal(shouldFinishLockedStairCrossing(3, 13_000, 17_001), false);
assert.equal(shouldFinishLockedStairCrossing(1, 13_000, 14_000), false);

const layeredSquad = new SquadCoordinator(50, 2);
layeredSquad.updateMember({
    botId: 1,
    playerId: 101,
    role: "leader",
    pos: { x: 40, y: 20 },
    layer: 0,
    dir: { x: 1, y: 0 },
    health: 100,
    downed: false,
    dead: false,
    underFire: false,
    state: "explore",
    updatedAt: 1000,
});
layeredSquad.updateMember({
    botId: 2,
    playerId: 102,
    role: "support",
    pos: { x: 40, y: 20 },
    layer: 1,
    dir: { x: 1, y: 0 },
    health: 100,
    downed: false,
    dead: false,
    underFire: false,
    state: "regroup",
    updatedAt: 1000,
});
assert.equal(
    layeredSquad.getFormationTarget(2, 1100),
    null,
    "ordinary 2D cohesion must be disabled across base floors",
);
assert.equal(
    layeredSquad.getLayeredFormationTarget(2, 1100)?.layer,
    0,
    "the layered formation anchor must retain the leader floor for stair routing",
);
const updateLeaderLayer = (layer: number, updatedAt: number): void => {
    layeredSquad.updateMember({
        botId: 1,
        playerId: 101,
        role: "leader",
        pos: { x: 40, y: 20 },
        layer,
        dir: { x: 1, y: 0 },
        health: 100,
        downed: false,
        dead: false,
        underFire: false,
        state: "explore",
        updatedAt,
    });
};
updateLeaderLayer(3, 1200);
assert.equal(
    layeredSquad.getLayeredFormationTarget(2, 1250),
    null,
    "a leader on the bunker-side stair half must not reverse follower cohesion",
);
updateLeaderLayer(2, 1300);
assert.equal(layeredSquad.getLayeredFormationTarget(2, 1350), null);
updateLeaderLayer(1, 1400);
assert.equal(
    layeredSquad.getLayeredFormationTarget(2, 1799),
    null,
    "a newly reached base floor must settle before issuing a cross-floor order",
);
updateLeaderLayer(1, 1800);
assert.equal(
    layeredSquad.getLayeredFormationTarget(2, 1801)?.layer,
    1,
    "a stable real floor becomes a valid formation routing target",
);

const retainedEnemy = {
    pos: { x: 20, y: 0 },
    layer: 0,
    kind: "enemy" as const,
};
assert.deepEqual(
    chooseGunfireSafetyTarget({
        currentState: "counterfire",
        timestamp: 2000,
        counterfireIntent: {
            pos: { x: 0, y: 18 },
            layer: 0,
            expiresAt: 2300,
        },
        fallback: retainedEnemy,
    }),
    { pos: { x: 0, y: 18 }, layer: 0, kind: "counterfire" },
    "trajectory B must be validated instead of unrelated retained enemy A",
);
assert.equal(
    chooseGunfireSafetyTarget({
        currentState: "combat",
        timestamp: 2000,
        counterfireIntent: {
            pos: { x: 0, y: 18 },
            layer: 0,
            expiresAt: 2300,
        },
        fallback: retainedEnemy,
    })?.kind,
    "enemy",
    "counterfire intent must not leak into ordinary combat",
);

assert.equal(
    evaluateCrossFloorShot({
        shooterPos: { x: 0, y: -10 },
        shooterLayer: 0,
        targetPos: { x: 0, y: -5 },
        targetLayer: 0,
        stairs: [],
    }).allowed,
    true,
    "完全同层射击不应被楼梯门控影响",
);

assert.equal(
    evaluateCrossFloorShot({
        shooterPos: { x: 0, y: -8 },
        shooterLayer: 0,
        targetPos: { x: 0, y: 8 },
        targetLayer: 1,
        stairs: [stair],
    }).allowed,
    false,
    "双方都不在楼梯 layer 时，禁止隔楼板射击",
);

assert.equal(
    evaluateCrossFloorShot({
        shooterPos: { x: 0, y: -8 },
        shooterLayer: 0,
        targetPos: { x: 0, y: 2 },
        targetLayer: 3,
        stairs: [stair],
    }).allowed,
    true,
    "敌人站在同一楼梯下端时应允许射击",
);

assert.equal(
    evaluateCrossFloorShot({
        shooterPos: { x: 0, y: -8 },
        shooterLayer: 0,
        targetPos: { x: 25, y: 2 },
        targetLayer: 3,
        stairs: [stair],
    }).allowed,
    false,
    "目标虽带楼梯 layer，但不在该楼梯碰撞区时必须拒绝",
);

assert.equal(
    evaluateCrossFloorShot({
        shooterPos: { x: 0, y: 8 },
        shooterLayer: 0,
        targetPos: { x: 0, y: 2 },
        targetLayer: 3,
        stairs: [stair],
    }).allowed,
    false,
    "地面层射手位于楼梯错误一侧时不能借楼梯位穿层射击",
);

assert.equal(
    evaluateCrossFloorShot({
        shooterPos: { x: 0, y: -2 },
        shooterLayer: 2,
        targetPos: { x: 0, y: 8 },
        targetLayer: 1,
        stairs: [stair],
    }).allowed,
    true,
    "AI 位于同一楼梯上端并朝地下侧射击时应允许",
);

// 弹道威胁必须按 layer 分开，避免同一玩家在楼上/楼下的轨迹被融合。
const engine = new BallisticInferenceEngine();
const viewport: ViewportBounds = {
    halfWidth: 40,
    halfHeight: 30,
    radius: 40,
    scopeLevel: 1,
    scopeType: "1xscope",
};
assert.equal(
    reconstructObservedBulletRange({
        definitionDistance: 100,
        definitionVariance: 0.1,
        varianceT: 1,
        distAdjIdx: 15,
        reflectCount: 0,
        clipDistance: true,
        clippedDistance: 5,
    }),
    5,
    "the wire's final clipped distance must not be expanded to the weapon definition range",
);
const baseObservation: Omit<BulletObservation, "layer" | "observedAt"> = {
    playerId: 9,
    pos: { x: -5, y: 0 },
    dir: { x: 1, y: 0 },
    bulletType: "bullet_9mm",
    bulletSpeed: 100,
    bulletRange: 100,
    damage: 20,
    obstacleDamage: 10,
    shrapnel: false,
};
engine.observe(
    { ...baseObservation, layer: 0, observedAt: 1000 },
    { x: 0, y: 0 },
    viewport,
    () => false,
);
engine.observe(
    { ...baseObservation, layer: 1, observedAt: 1010 },
    { x: 0, y: 0 },
    viewport,
    () => false,
);
assert.equal(engine.threatForPlayer(9, 1100, 0)?.layer, 0);
assert.equal(engine.threatForPlayer(9, 1100, 1)?.layer, 1);

const longRangeEngine = new BallisticInferenceEngine();
const offscreenThreat = longRangeEngine.observe(
    {
        ...baseObservation,
        playerId: 10,
        pos: { x: -80, y: 0 },
        dir: { x: 1, y: 0 },
        bulletRange: 100,
        layer: 0,
        observedAt: 1200,
    },
    { x: 0, y: 0 },
    viewport,
    () => false,
);
assert(offscreenThreat, "an off-screen muzzle whose finite ray reaches the client must be retained");
assert.equal(offscreenThreat.estimatedShooterPos.x, -80);
assert.equal(offscreenThreat.estimatedShooterPos.y, 0);
const edgeAim = estimateShooterSearchPoint(offscreenThreat, { x: 0, y: 0 }, viewport);
assert.equal(pointInsideViewport({ x: 0, y: 0 }, edgeAim, viewport, 0.5), true);
assert.equal(
    pointInsideViewport(
        { x: 0, y: 0 },
        offscreenThreat.estimatedShooterPos,
        viewport,
        0.5,
    ),
    false,
    "the screen-edge aim point must not turn the real shooter into an on-screen fire target",
);
assert.equal(
    longRangeEngine.observe(
        {
            ...baseObservation,
            playerId: 11,
            pos: { x: -80, y: 12 },
            dir: { x: 1, y: 0 },
            bulletRange: 100,
            layer: 0,
            observedAt: 1210,
        },
        { x: 0, y: 0 },
        viewport,
        () => false,
    ),
    null,
    "a distant trajectory that misses the bot must not become a threat",
);
assert.equal(
    longRangeEngine.observe(
        {
            ...baseObservation,
            playerId: 12,
            pos: { x: -120, y: 0 },
            dir: { x: 1, y: 0 },
            bulletRange: 100,
            layer: 0,
            observedAt: 1220,
        },
        { x: 0, y: 0 },
        viewport,
        () => false,
    ),
    null,
    "an infinite ray must not be accepted after its finite bullet range ends",
);
assert.equal(
    longRangeEngine.observe(
        {
            ...baseObservation,
            playerId: 14,
            pos: { x: -10, y: 0 },
            dir: { x: 1, y: 0 },
            bulletRange: 5,
            layer: 0,
            observedAt: 1225,
        },
        { x: 0, y: 0 },
        viewport,
        () => false,
    ),
    null,
    "a clipped segment that ends before reaching the bot must not become a threat",
);
const reflectedThreat = longRangeEngine.observe(
    {
        ...baseObservation,
        playerId: 13,
        pos: { x: -12, y: 0 },
        dir: { x: 1, y: 0 },
        layer: 0,
        observedAt: 1230,
        reflectCount: 1,
        reflectObjId: 444,
    },
    { x: 0, y: 0 },
    viewport,
    () => false,
);
assert(reflectedThreat);
assert.equal(reflectedThreat.reflected, true);
assert.match(
    reflectedThreat.key,
    /:r1:444$/,
    "ricochet segments must not merge with direct muzzle bearings",
);

const smartBotSource = fs.readFileSync(path.join(import.meta.dirname, "smartBot.ts"), "utf8");
assert(smartBotSource.includes("counterfire_cross_floor_blocked"));
assert(smartBotSource.includes("gunfire_cross_floor_blocked"));
assert(smartBotSource.includes("currentGunfireReasonTarget"));
assert(smartBotSource.includes("crossFloorFireDecision"));
assert(smartBotSource.includes("const sourcePoint = threat.estimatedShooterPos"));
assert(smartBotSource.includes("pointInsideViewport(myPos, sourcePoint"));
assert(smartBotSource.includes("if (threat.reflected)"));
assert(!smartBotSource.includes("Boolean(enemyLayer & 0x2)"));

console.log("V56 cross-floor fire smoke test passed");
