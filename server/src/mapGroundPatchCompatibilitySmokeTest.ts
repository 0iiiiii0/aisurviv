import assert from "node:assert/strict";
import { normalizeMapGroundPatch } from "./bot/mapStrategy.ts";

const common = {
    color: 0x12345678,
    roughness: 0.25,
    offsetDist: 3,
    order: 2,
    useAsMapShape: true,
};

const circle = normalizeMapGroundPatch({
    ...common,
    bound: { type: 0, pos: { x: 20, y: 30 }, rad: 5 },
});
assert.deepEqual(circle.min, { x: 15, y: 25 });
assert.deepEqual(circle.max, { x: 25, y: 35 });

const aabb = normalizeMapGroundPatch({
    ...common,
    bound: { type: 1, min: { x: 1, y: 2 }, max: { x: 8, y: 9 } },
});
assert.deepEqual(aabb.min, { x: 1, y: 2 });
assert.deepEqual(aabb.max, { x: 8, y: 9 });

const legacy = normalizeMapGroundPatch({
    ...common,
    min: { x: 11, y: 12 },
    max: { x: 18, y: 19 },
});
assert.deepEqual(legacy.min, { x: 11, y: 12 });
assert.deepEqual(legacy.max, { x: 18, y: 19 });

console.log("map ground-patch compatibility smoke test passed");
