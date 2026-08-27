import assert from "node:assert/strict";
import {
    cameraViewportHalfExtents,
    pointInsideViewport,
    viewportForMaxScope,
} from "./bot/combatIntelligence.ts";
import { shouldInterruptRecoveryForThreat } from "./bot/combatRecovery.ts";
import { shouldForceVisibleTrigger } from "./bot/engagementRecovery.ts";
import {
    GameFaultCircuitBreaker,
    heartbeatState,
} from "./game/gameProcessHealth.ts";

const center = { x: 100, y: 100 };
const raw1x = cameraViewportHalfExtents(28, 16 / 9);
assert.ok(Math.abs(raw1x.halfWidth - 28) < 1e-6);
assert.ok(Math.abs(raw1x.halfHeight - 15.75) < 1e-6);

const oneX = viewportForMaxScope(center, 28, "1xscope", { "15xscope": 1 });
assert.equal(oneX.scopeType, "1xscope", "a backpack 15x must not expand active 1x vision");
assert.equal(pointInsideViewport(center, { x: 126.9, y: 100 }, oneX), true);
assert.equal(pointInsideViewport(center, { x: 128, y: 100 }, oneX), false);
assert.equal(pointInsideViewport(center, { x: 100, y: 114.8 }, oneX), true);
assert.equal(pointInsideViewport(center, { x: 100, y: 116 }, oneX), false);
// The final packet gate allows only a thin 0.65 interpolation margin on top of
// the 0.9 acquisition inset: 1x horizontal limit is therefore 27.75, not the
// old oversized 49.8-unit rectangle.
assert.equal(pointInsideViewport(center, { x: 127.7, y: 100 }, oneX, 0.65), true);
assert.equal(pointInsideViewport(center, { x: 127.8, y: 100 }, oneX, 0.65), false);

const fourX = viewportForMaxScope(center, 48, "4xscope", {});
assert.equal(pointInsideViewport(center, { x: 147, y: 100 }, fourX), true);
assert.equal(pointInsideViewport(center, { x: 149, y: 100 }, fourX), false);
assert.equal(pointInsideViewport(center, { x: 100, y: 126 }, fourX), true);
assert.equal(pointInsideViewport(center, { x: 100, y: 128 }, fourX), false);

const baseThreat = {
    survivalLocked: false,
    hasEnemy: true,
    enemyDead: false,
    teammate: false,
    sameLayer: true,
    onScreen: true,
    lineClear: true,
    weaponKind: "gun" as const,
    ammo: 5,
    distance: 8,
    weaponRange: 30,
};
assert.equal(shouldInterruptRecoveryForThreat(baseThreat), true);
assert.equal(shouldInterruptRecoveryForThreat({ ...baseThreat, onScreen: false }), false);
assert.equal(shouldInterruptRecoveryForThreat({ ...baseThreat, survivalLocked: true }), false);
assert.equal(shouldInterruptRecoveryForThreat({ ...baseThreat, ammo: 0 }), false);
assert.equal(
    shouldForceVisibleTrigger({
        difficulty: "normal",
        reactionMs: 250,
        visibleForMs: 1_231,
        legalLine: true,
        inRange: true,
        ammoReady: true,
    }),
    true,
    "a legal visible target must receive a deterministic trigger after the deadline",
);
assert.equal(
    shouldForceVisibleTrigger({
        difficulty: "normal",
        reactionMs: 250,
        visibleForMs: 1_100,
        legalLine: true,
        inRange: true,
        ammoReady: true,
    }),
    false,
);

const timestamp = 100_000;
assert.equal(heartbeatState(timestamp, timestamp + 5_000), "healthy");
assert.equal(heartbeatState(timestamp, timestamp + 15_000), "warning");
assert.equal(heartbeatState(timestamp, timestamp + 31_000), "terminate");

const breaker = new GameFaultCircuitBreaker();
const first = breaker.failure(timestamp);
assert.equal(first.fatal, false);
assert.ok(first.pauseMs >= 80);
breaker.success();
const afterSuccess = breaker.failure(timestamp + 100);
assert.equal(afterSuccess.consecutive, 1, "a successful tick resets consecutive failures");
let fatal = afterSuccess;
for (let i = 0; i < 44; i++) fatal = breaker.failure(timestamp + 200 + i);
assert.equal(fatal.fatal, true, "a sustained 30-second fault storm is isolated and reported");

console.log("V34 vision and isolated game-process resilience smoke test passed.");
