import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
    FullMapPathPlanner,
    type FullMapPathObstacle,
} from "./bot/fullMapPathPlanner.ts";

const wall = (
    id: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    layer = 1,
): FullMapPathObstacle => ({
    id,
    layer,
    collision: {
        type: 1,
        min: { x: minX, y: minY },
        max: { x: maxX, y: maxY },
    },
});

const tunnelWalls = [
    wall(1, 49, 0, 51, 28),
    wall(2, 49, 36, 51, 60),
];
const ammunitionBox: FullMapPathObstacle = {
    id: 3,
    layer: 1,
    collision: { type: 0, pos: { x: 50, y: 32 }, rad: 2.7 },
};

// This models the reported bunker entrance: the short/front opening is sealed
// by an ammunition box that an unarmed bot cannot destroy, while a longer rear
// route remains available around the wall end.
const blockedEntrancePlanner = new FullMapPathPlanner({
    width: 120,
    height: 80,
    obstacles: [...tunnelWalls, ammunitionBox],
    cellSize: 2,
    clearance: 1.18,
});
const rearRoute = blockedEntrancePlanner.plan(
    { x: 20, y: 32 },
    { x: 90, y: 32 },
    1,
);
assert.ok(rearRoute, "a blocked front entrance must still find the rear entrance");
assert.ok(
    rearRoute.waypoints.some((point) => point.y > 61),
    "the route must go around the rear wall end instead of pushing into the ammunition box",
);
assert.ok(
    rearRoute.waypoints.every((point, index, points) =>
        blockedEntrancePlanner.isSegmentClear(
            index === 0 ? { x: 20, y: 32 } : points[index - 1],
            point,
            1,
        )
    ),
    "every smoothed route segment must remain collision-free",
);

const clearEntrancePlanner = new FullMapPathPlanner({
    width: 120,
    height: 80,
    obstacles: tunnelWalls,
    cellSize: 2,
    clearance: 1.18,
});
const frontRoute = clearEntrancePlanner.plan(
    { x: 20, y: 32 },
    { x: 90, y: 32 },
    1,
);
assert.ok(frontRoute);
assert.ok(
    frontRoute.waypoints.every((point) => point.y < 45),
    "without the ammunition box the planner should use the shorter front entrance",
);

const usableDoorPlanner = new FullMapPathPlanner({
    width: 120,
    height: 80,
    obstacles: [
        ...tunnelWalls,
        { ...ammunitionBox, id: 4, openableDoor: true },
    ],
    cellSize: 2,
    clearance: 1.18,
});
const usableDoorRoute = usableDoorPlanner.plan(
    { x: 20, y: 32 },
    { x: 90, y: 32 },
    1,
);
assert.ok(
    usableDoorRoute?.waypoints.some((point) =>
        Math.hypot(point.x - 50, point.y - 32) < 0.1
    ),
    "a usable unlocked door must become an explicit portal waypoint",
);

assert.equal(
    blockedEntrancePlanner.plan({ x: 20, y: 32 }, { x: 90, y: 32 }, 0)?.waypoints.length,
    1,
    "bunker-layer obstacles must not block a ground-layer route",
);

const sealedPlanner = new FullMapPathPlanner({
    width: 80,
    height: 60,
    obstacles: [wall(10, 38, 0, 42, 60, 0)],
    cellSize: 2,
    clearance: 1.18,
});
assert.equal(
    sealedPlanner.plan({ x: 15, y: 30 }, { x: 65, y: 30 }, 0),
    null,
    "a fully sealed objective must be rejected instead of causing endless local avoidance",
);
assert.deepEqual(
    sealedPlanner.reachableTargets(
        { x: 15, y: 30 },
        [{ x: 20, y: 30 }, { x: 65, y: 30 }],
        0,
    ),
    [true, false],
    "batch topology queries must distinguish the local room from a sealed network",
);
assert.deepEqual(
    blockedEntrancePlanner.reachableTargets(
        { x: 20, y: 32 },
        [{ x: 24, y: 32 }, { x: 90, y: 32 }],
        1,
    ),
    [true, true],
    "one flood fill must recognize both a direct point and a target reachable by the rear route",
);

const sourceRoot = import.meta.dirname;
const clientSource = fs.readFileSync(path.join(sourceRoot, "game", "client.ts"), "utf8");
const botSource = fs.readFileSync(path.join(sourceRoot, "smartBot.ts"), "utf8");
assert.ok(clientSource.includes("...game.map.obstacles"));
assert.ok(clientSource.includes("...game.map.structures"));
assert.ok(clientSource.includes("this.player?.serverBot"));
assert.ok(botSource.includes("this.ensureFullMapPathPlanner();"));
assert.ok(botSource.includes("this.fullMapRouteCommand("));
assert.ok(botSource.includes("finalTarget,"));

console.log("Full-map path planner smoke test passed");
