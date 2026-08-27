import assert from "assert";

import {
    closeRangeCombatDirection,
    coverGeometry,
    nextPeekPhase,
    obstacleBlocksBody,
    predictInterceptPoint,
} from "./bot/combatTactics.ts";
import {
    ConcealmentTracker,
    chooseConcealmentStandoffPoint,
    concealmentBlocksVisualContact,
    concealmentEdgeDistance,
    hiddenContactAimPoint,
    outsideConcealmentOneXVision,
    type ConcealmentZone,
} from "./bot/concealmentIntelligence.ts";

const intercept = predictInterceptPoint({
    shooterPos: { x: 0, y: 0 },
    targetPos: { x: 50, y: 0 },
    targetVelocity: { x: 0, y: 6 },
    targetAcceleration: { x: 0, y: 0 },
    projectileSpeed: 100,
    leadFactor: 1,
});
assert(intercept.point.y > 2, "moving target must be led instead of aimed at current position");
assert(intercept.interceptSeconds > 0 && intercept.interceptSeconds < 0.9);

const close = closeRangeCombatDirection({
    myPos: { x: 0, y: 0 },
    enemyPos: { x: 4, y: 0 },
    enemyVelocity: { x: 0, y: 3 },
    enemyFacing: { x: -1, y: 0 },
    desiredDistance: 7,
    strafeSign: 1,
    health: 25,
    recentlyDamaged: true,
    targetDistance: 4,
});
assert(close.x < 0, "a hurt bot inside its desired range must create distance");
assert(Math.abs(close.y) > 0.25, "close combat must retain a lateral dodge component");

const cover = coverGeometry({
    obstaclePos: { x: 10, y: 0 },
    obstacleRadius: 2,
    enemyPos: { x: 0, y: 0 },
    playerRadius: 0.72,
});
assert(cover.anchor.x > 12.5, "hidden anchor must sit fully behind the obstacle");
assert(cover.leftPeek.y * cover.rightPeek.y < 0, "peek points must exist on opposite sides");
assert(
    obstacleBlocksBody({ x: 0, y: 0 }, cover.anchor, { x: 10, y: 0 }, 2, 0.72),
    "the hidden anchor must keep the whole player collider behind cover",
);

const peek = nextPeekPhase({
    phase: "hide",
    timestamp: 1000,
    phaseUntil: 900,
    alignedForShot: false,
    firedDuringPeek: false,
    automatic: false,
    fireDelayMs: 500,
});
assert.equal(peek.phase, "peek");
const retreat = nextPeekPhase({
    phase: "peek",
    timestamp: 1200,
    phaseUntil: 1500,
    alignedForShot: true,
    firedDuringPeek: true,
    automatic: false,
    fireDelayMs: 500,
});
assert.equal(retreat.phase, "return");

const smokeZone: ConcealmentZone = {
    key: "smoke:7",
    kind: "smoke",
    center: { x: 20, y: 0 },
    radius: 6,
    layer: 0,
    objectId: 7,
    buildingId: 0,
    destructible: false,
    healthT: 1,
    ceilingDead: false,
    ceilingDamaged: false,
    occupied: false,
    supportIds: [],
};
assert.equal(
    concealmentBlocksVisualContact({ x: 0, y: 0 }, { x: 22, y: 0 }, smokeZone),
    true,
    "smoke crossing the sight line must hide the exact player position",
);
assert.equal(
    concealmentBlocksVisualContact({ x: 19, y: 0 }, { x: 22, y: 0 }, smokeZone),
    false,
    "players sharing the same smoke at close range remain visible",
);

const standoff = chooseConcealmentStandoffPoint({
    botPos: { x: 8, y: 0 },
    zone: smokeZone,
    mapWidth: 200,
    mapHeight: 200,
    preferredDirection: { x: -1, y: 0 },
});
assert(standoff, "a safe concealment standoff point must be generated");
assert.equal(
    outsideConcealmentOneXVision(standoff.point, smokeZone),
    true,
    "standoff point must remain beyond the hidden player's 1x vision distance",
);
assert.ok(
    concealmentEdgeDistance(standoff.point, smokeZone) >= 30,
    "the bot must stay roughly one full 1x view beyond the concealment edge",
);
assert.ok(
    standoff.point.x < smokeZone.center.x,
    "the route should preserve the bot's current side instead of crossing the hidden zone",
);
const grenadeStandoff = chooseConcealmentStandoffPoint({
    botPos: { x: 80, y: 0 },
    zone: smokeZone,
    mapWidth: 200,
    mapHeight: 200,
    preferredDirection: { x: 1, y: 0 },
    maximumRingOffset: 3.1,
});
assert(grenadeStandoff, "a grenade-range safe-ring point must be generated");
assert.ok(
    grenadeStandoff.edgeDistance <= 34,
    "grenade staging must stay near the inner side of the one-view safety ring",
);
const tracker = new ConcealmentTracker();
tracker.update(
    [{
        enemyId: 12,
        visible: true,
        pos: { x: 15.5, y: 0 },
        velocity: { x: 5, y: 0 },
        layer: 0,
    }],
    [smokeZone],
    1000,
);
const hidden = tracker.update(
    [{ enemyId: 12, visible: false, layer: 0 }],
    [smokeZone],
    1120,
)[0];
assert(hidden, "an enemy seen entering smoke must become a hidden contact");
assert.equal(hidden.kind, "smoke");
const blindAim = hiddenContactAimPoint(hidden, smokeZone, 1300);
assert.ok(
    Math.hypot(blindAim.x - smokeZone.center.x, blindAim.y - smokeZone.center.y) <=
        smokeZone.radius,
    "blind fire must sweep inside smoke instead of using a hidden live coordinate",
);

console.log("Combat tactics smoke test passed: intercept tracking, cover, smoke memory, and controlled blind fire.");
