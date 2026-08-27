import assert from "node:assert/strict";
import {
    FullMapPathPlanner,
    type FullMapPathObstacle,
} from "./bot/fullMapPathPlanner.ts";
import {
    type NavigationBlocker,
    planLocalSteering,
    type Point2,
} from "./bot/navigationController.ts";

const localClearance = 1.18;
const routeClearance = 1.58;
const distance = (a: Point2, b: Point2): number => Math.hypot(a.x - b.x, a.y - b.y);

const box = (
    id: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    openableDoor = false,
): FullMapPathObstacle => ({
    id,
    layer: 0,
    collision: {
        type: 1,
        min: { x: minX, y: minY },
        max: { x: maxX, y: maxY },
    },
    openableDoor,
});

const circle = (
    id: number,
    x: number,
    y: number,
    radius: number,
): FullMapPathObstacle => ({
    id,
    layer: 0,
    collision: { type: 0, pos: { x, y }, rad: radius },
});

interface MovementSimulationResult {
    reached: boolean;
    frames: number;
    ordinaryAvoidanceEvents: number;
    openedDoors: number;
    finalPosition: Point2;
    avoidanceBlockerIds: number[];
}

function simulateMovement(
    planner: FullMapPathPlanner,
    obstacles: readonly FullMapPathObstacle[],
    start: Point2,
    target: Point2,
): MovementSimulationResult {
    const route = planner.plan(start, target, 0);
    assert.ok(route, "advance planner must produce a route");
    const openDoors = new Set<number>();
    const avoidanceBlockerIds: number[] = [];
    let ordinaryAvoidanceEvents = 0;
    let position = { ...start };
    let waypointIndex = 0;
    let frames = 0;

    for (; frames < 8_000 && waypointIndex < route.waypoints.length; frames++) {
        const waypoint = route.waypoints[waypointIndex];
        if (distance(position, waypoint) <= 0.45) {
            waypointIndex++;
            continue;
        }
        const blockers: NavigationBlocker[] = obstacles
            .filter((obstacle) => !openDoors.has(obstacle.id))
            .map((obstacle) => ({
                id: obstacle.id,
                pos: obstacle.collision.type === 0
                    ? obstacle.collision.pos
                    : {
                        x: (obstacle.collision.min.x + obstacle.collision.max.x) * 0.5,
                        y: (obstacle.collision.min.y + obstacle.collision.max.y) * 0.5,
                    },
                radius: obstacle.collision.type === 0
                    ? obstacle.collision.rad
                    : Math.hypot(
                        obstacle.collision.max.x - obstacle.collision.min.x,
                        obstacle.collision.max.y - obstacle.collision.min.y,
                    ) * 0.5,
                collision: obstacle.collision,
                openableDoor: obstacle.openableDoor,
            }));
        const local = planLocalSteering(position, waypoint, blockers, {
            clearance: localClearance,
            preferredSide: 1,
            bounds: { minX: 1, minY: 1, maxX: 179, maxY: 109 },
        });
        if (local.blocked && local.approachDoor) {
            const door = obstacles.find((obstacle) => obstacle.id === local.blockerId);
            assert.ok(door);
            const doorPosition = door.collision.type === 0
                ? door.collision.pos
                : {
                    x: (door.collision.min.x + door.collision.max.x) * 0.5,
                    y: (door.collision.min.y + door.collision.max.y) * 0.5,
                };
            if (distance(position, doorPosition) <= 4.35) openDoors.add(door.id);
        } else if (local.blocked) {
            ordinaryAvoidanceEvents++;
            if (!avoidanceBlockerIds.includes(local.blockerId)) {
                avoidanceBlockerIds.push(local.blockerId);
            }
        }

        const step = 0.24;
        position = {
            x: position.x + local.direction.x * step,
            y: position.y + local.direction.y * step,
        };
    }

    return {
        reached: waypointIndex >= route.waypoints.length && distance(position, target) <= 1.5,
        frames,
        ordinaryAvoidanceEvents,
        openedDoors: openDoors.size,
        finalPosition: position,
        avoidanceBlockerIds,
    };
}

// Two large rooms connected by real door portals, followed by a perpendicular
// corridor. The extra fixtures force a long S-shaped route instead of a direct
// line, closely matching bunker/large-house navigation.
const indoorObstacles: FullMapPathObstacle[] = [
    box(1, 44, 0, 46, 47),
    box(2, 44, 55, 46, 110),
    box(3, 44, 47, 46, 55, true),
    box(4, 44, 69, 77, 71),
    box(5, 85, 69, 180, 71),
    box(6, 77, 69, 85, 71, true),
    circle(10, 64, 28, 5.5),
    circle(11, 91, 50, 6),
    box(12, 116, 77, 128, 87),
    box(13, 139, 91, 149, 101),
];
const indoorPlanner = new FullMapPathPlanner({
    width: 180,
    height: 110,
    obstacles: indoorObstacles,
    cellSize: 2.5,
    clearance: routeClearance,
});
const indoorResult = simulateMovement(
    indoorPlanner,
    indoorObstacles,
    { x: 18, y: 24 },
    { x: 165, y: 94 },
);
assert.ok(indoorResult.reached, `indoor bot did not reach target: ${JSON.stringify(indoorResult)}`);
assert.equal(indoorResult.openedDoors, 2, "the route should intentionally traverse both doors");
assert.equal(
    indoorResult.ordinaryAvoidanceEvents,
    0,
    `a planned indoor route must not fall back to ordinary avoidance: ${indoorResult.avoidanceBlockerIds.join(",")}`,
);

// Dense alternating barriers form a long serpentine route. There are no doors,
// so every local avoidance activation is a genuine mismatch between the global
// raster and the exact movement collision model.
const mazeObstacles: FullMapPathObstacle[] = [];
let nextId = 100;
for (let x = 30; x <= 150; x += 20) {
    const openingAtTop = ((x - 30) / 20) % 2 === 0;
    mazeObstacles.push(
        openingAtTop
            ? box(nextId++, x, 0, x + 2.4, 78)
            : box(nextId++, x, 32, x + 2.4, 110),
    );
}
mazeObstacles.push(
    circle(nextId++, 21, 48, 4),
    circle(nextId++, 160, 58, 4.5),
);
const mazePlanner = new FullMapPathPlanner({
    width: 180,
    height: 110,
    obstacles: mazeObstacles,
    cellSize: 2.5,
    clearance: routeClearance,
});
const mazeResult = simulateMovement(
    mazePlanner,
    mazeObstacles,
    { x: 12, y: 16 },
    { x: 169, y: 96 },
);
assert.ok(mazeResult.reached, `maze bot did not reach target: ${JSON.stringify(mazeResult)}`);
assert.equal(mazeResult.openedDoors, 0);
assert.equal(
    mazeResult.ordinaryAvoidanceEvents,
    0,
    `a planned complex-terrain route must not trigger local avoidance: ${mazeResult.avoidanceBlockerIds.join(",")}`,
);

console.log(
    "Full-map point-to-point movement smoke test passed: "
        + `indoorFrames=${indoorResult.frames}, indoorDoors=${indoorResult.openedDoors}, `
        + `mazeFrames=${mazeResult.frames}, ordinaryAvoidance=0.`,
);
