import assert from "assert";
import fs from "fs";
import path from "path";
import { buildIndoorSearchProbes } from "./bot/indoorSearch.ts";
import {
    FLOOR_PURSUIT_MEMORY_MS,
    floorPursuitRequired,
    pursuitSearchPhase,
    retainChangedFloorContact,
} from "./bot/pursuitContinuity.ts";
import { chooseStairTraversal } from "./bot/stairNavigation.ts";

assert.equal(floorPursuitRequired(0, 1), true);
assert.equal(floorPursuitRequired(2, 1), true);
assert.equal(floorPursuitRequired(0, 2), false);

assert.equal(
    retainChangedFloorContact({
        memoryLayer: 2,
        observedLayer: 1,
        memoryAgeMs: 850,
        currentTarget: true,
        lockedTraversal: false,
    }),
    true,
    "a current target must survive stair-half -> destination-floor transition",
);
assert.equal(
    retainChangedFloorContact({
        memoryLayer: 2,
        observedLayer: 1,
        memoryAgeMs: FLOOR_PURSUIT_MEMORY_MS + 1,
        currentTarget: true,
        lockedTraversal: false,
    }),
    false,
    "unlocked floor pursuit must expire",
);
assert.equal(
    retainChangedFloorContact({
        memoryLayer: 2,
        observedLayer: 1,
        memoryAgeMs: FLOOR_PURSUIT_MEMORY_MS + 1000,
        currentTarget: false,
        lockedTraversal: true,
    }),
    true,
    "a bot already on a stair must finish its bounded connector lock",
);

assert.equal(
    pursuitSearchPhase({ floorChangeRequired: false, distanceToAnchor: 7 }),
    "approach",
    "room sweep cannot replace the doorway/last-seen approach",
);
assert.equal(
    pursuitSearchPhase({ floorChangeRequired: false, distanceToAnchor: 2.8 }),
    "sweep",
);
assert.equal(
    pursuitSearchPhase({ floorChangeRequired: true, distanceToAnchor: 0.2 }),
    "approach",
    "a 2D overlap on another floor must still route through stairs",
);

const stair = {
    structureId: 77,
    stairIndex: 0,
    min: { x: 8, y: -2 },
    max: { x: 12, y: 2 },
    downDir: { x: 0, y: 1 },
};
const stairPlan = chooseStairTraversal({
    position: { x: 0, y: 0 },
    currentLayer: 0,
    target: { x: 20, y: 0 },
    targetLayer: 1,
    stairs: [stair],
    playerRadius: 0.72,
});
assert(stairPlan);
assert.equal(stairPlan.structureId, 77);
assert.equal(stairPlan.phase, "approach");

const roomRegions = [
    { min: { x: 20, y: 20 }, max: { x: 30, y: 30 } },
    { min: { x: 30, y: 23 }, max: { x: 40, y: 27 } },
];
const probes = buildIndoorSearchProbes(
    roomRegions,
    { x: 30, y: 25 },
    1.15,
    { x: 18, y: 25 },
);
assert(probes.length >= 2, "a multi-room pursuit needs more than one interior probe");
assert(
    probes.every((probe) =>
        roomRegions.some(
            (region) =>
                probe.x >= region.min.x &&
                probe.x <= region.max.x &&
                probe.y >= region.min.y &&
                probe.y <= region.max.y,
        ),
    ),
    "room pursuit probes must stay inside the building",
);

const source = fs.readFileSync(path.join(import.meta.dirname, "smartBot.ts"), "utf8");
assert(source.includes("retainChangedFloorContact({"));
assert(source.includes("pursueEnemyAcrossFloorContact("));
assert(source.includes('type: "cross_floor_pursuit_started"'));
assert(source.includes('type: "room_pursuit_started"'));
assert(source.includes('phase = "room-sweep"'));
assert(source.includes("evaluateGunfireLayerSafety(timestamp)"));
assert(source.includes("evaluateGunfireWallSafety("));

console.log("V57 floor/room pursuit continuity smoke test passed");
