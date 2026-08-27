import assert from "node:assert/strict";
import { viewportForMaxScope, pointInsideViewport } from "./bot/combatIntelligence.ts";
import { duelFlankPoint, duelSearchDirection, inferDuelOpponentSpawn } from "./bot/duelStrategy.ts";

const center = { x: 50, y: 50 };
const viewport = viewportForMaxScope(center, 28, "1xscope", { "15xscope": 1 });
assert.equal(viewport.scopeType, "1xscope");
assert.ok(viewport.radius < 28);
assert.equal(pointInsideViewport(center, { x: 50, y: 66 }, viewport), false);
assert.equal(pointInsideViewport(center, { x: 50, y: 64 }, viewport), true);
assert.equal(pointInsideViewport(center, { x: 78, y: 50 }, viewport), false);
assert.equal(pointInsideViewport(center, { x: 77, y: 50 }, viewport), true);

const fourTimesViewport = viewportForMaxScope(center, 48, "4xscope", {});
const eightTimesViewport = viewportForMaxScope(center, 68, "8xscope", {});
assert.equal(pointInsideViewport(center, { x: 50, y: 78 }, fourTimesViewport), false);
assert.equal(pointInsideViewport(center, { x: 50, y: 76 }, fourTimesViewport), true);
assert.equal(pointInsideViewport(center, { x: 50, y: 88 }, eightTimesViewport), false);
assert.equal(pointInsideViewport(center, { x: 50, y: 87 }, eightTimesViewport), true);
assert.equal(fourTimesViewport.scopeLevel, 4);
assert.equal(eightTimesViewport.scopeLevel, 8);

const opponent = inferDuelOpponentSpawn({ x: 35.2, y: 68 }, 176, 136);
assert.ok(Math.abs(opponent.x - 140.8) < 0.01);
assert.ok(Math.abs(opponent.y - 68) < 0.01);

const flankA = duelFlankPoint({
    myPos: { x: 30, y: 68 }, targetPos: { x: 145, y: 68 }, obstaclePos: { x: 90, y: 68 },
    obstacleRadius: 2, mapWidth: 176, mapHeight: 136, flankSign: 1,
});
const flankB = duelFlankPoint({
    myPos: { x: 30, y: 68 }, targetPos: { x: 145, y: 68 }, obstaclePos: { x: 90, y: 68 },
    obstacleRadius: 2, mapWidth: 176, mapHeight: 136, flankSign: -1,
});
assert.notEqual(Math.sign(flankA.y - 68), Math.sign(flankB.y - 68));
const search = duelSearchDirection({ x: 30, y: 68 }, { x: 145, y: 68 }, false, 1);
assert.ok(search.x > 0.99 && Math.abs(search.y) < 0.01);
console.log("Duel vision/search smoke test passed.");
