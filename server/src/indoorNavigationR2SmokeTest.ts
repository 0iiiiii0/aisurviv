import assert from "assert";
import fs from "fs";
import path from "path";
import {
    buildIndoorDoorPortal,
    planIndoorPortalRoute,
    portalExitPoint,
    selectOpenBoundaryExit,
} from "./bot/indoorNavigation.ts";
import { buildIndoorSearchProbes } from "./bot/indoorSearch.ts";
import {
    isNavigationSegmentClear,
    type NavigationBlocker,
} from "./bot/navigationController.ts";

const aabb = (
    id: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    openableDoor = false,
): NavigationBlocker => ({
    id,
    pos: { x: (minX + maxX) * 0.5, y: (minY + maxY) * 0.5 },
    radius: Math.hypot(maxX - minX, maxY - minY) * 0.5,
    collision: {
        type: 1,
        min: { x: minX, y: minY },
        max: { x: maxX, y: maxY },
    },
    openableDoor,
});

// Three rooms divided by two walls. Each wall has one narrow doorway.
const blockers: NavigationBlocker[] = [
    aabb(101, 4.55, -10, 5.45, -1.55),
    aabb(102, 4.55, 1.55, 5.45, 10),
    aabb(1, 4.55, -1.25, 5.45, 1.25, true),
    aabb(201, 9.55, -10, 10.45, -1.55),
    aabb(202, 9.55, 1.55, 10.45, 10),
    aabb(2, 9.55, -1.25, 10.45, 1.25, true),
];
const isClear = (
    from: { x: number; y: number },
    to: { x: number; y: number },
    ignoredDoorIds: ReadonlySet<number>,
): boolean =>
    isNavigationSegmentClear(from, to, blockers, 0.24, ignoredDoorIds);

const from = { x: 0, y: 0 };
const target = { x: 15, y: 0 };
const doors = [
    { id: 1, pos: { x: 5, y: 0 }, open: false },
    { id: 2, pos: { x: 10, y: 0 }, open: false },
];
const route = planIndoorPortalRoute(from, target, doors, isClear, {
    portalProbeDistance: 4.4,
    portalOffset: 2.1,
    closedDoorCost: 2.5,
});
assert(route, "a two-door indoor route must be found");
assert.deepStrictEqual(
    route.doorIds,
    [1, 2],
    "Dijkstra must preserve the connected room order instead of selecting one greedy door",
);
assert.strictEqual(
    route.waypoints.filter((waypoint) => waypoint.kind === "door").length,
    2,
    "every crossed door requires an explicit interaction waypoint",
);
assert(
    route.waypoints.some((waypoint) => waypoint.kind === "door-exit"),
    "the route must continue to a stable point beyond the door collider",
);

const diagonalPortal = buildIndoorDoorPortal(
    doors[0],
    { x: 1, y: 3.5 },
    { x: 8.5, y: -2.5 },
    isClear,
    { portalProbeDistance: 4.4, portalOffset: 2.1 },
);
assert(diagonalPortal, "door free-space probing must infer a usable portal axis");
assert(
    Math.abs(diagonalPortal.axis.x) > 0.82,
    "the inferred crossing axis must follow the doorway, not the diagonal approach vector",
);
const exit = portalExitPoint(diagonalPortal, { x: 1, y: 3.5 }, { x: 8.5, y: -2.5 });
assert(exit.x > 5, "portal exit must be on the opposite side of the wall");

assert.strictEqual(
    planIndoorPortalRoute({ x: 0, y: -8 }, { x: 3, y: -8 }, doors, isClear),
    null,
    "a clear same-room segment must not allocate a door graph",
);

let penaltyCalls = 0;
const penalized = planIndoorPortalRoute(from, target, doors, isClear, {
    pointPenalty: (point) => {
        penaltyCalls += 1;
        return Math.abs(point.y) > 4 ? 20 : 0;
    },
});
assert(penalized && penaltyCalls > 0, "route costs must accept indoor/outdoor point penalties");

// shack_02-style buildings have a literal wall gap and no Door object. The
// exit selector must scan the full boundary rather than pushing toward the
// objective through a wall or reporting that the room has no exit.
const openGapExit = selectOpenBoundaryExit(
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    (point) => Math.abs(point.x) <= 5 && Math.abs(point.y) <= 5,
    (_start, end) => end.y > 5 && Math.abs(end.x) < 1.6,
    { angleSteps: 48, probeDistances: [4, 6, 8, 11] },
);
assert(openGapExit, "a doorless open boundary must produce an exit portal");
assert(
    openGapExit.y > 5 && Math.abs(openGapExit.x) < 1.6,
    "the selected exit must cross the actual open gap even when it faces away from the objective",
);
assert.strictEqual(
    selectOpenBoundaryExit(
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        (point) => Math.abs(point.x) <= 5 && Math.abs(point.y) <= 5,
        () => false,
    ),
    null,
    "sealed geometry must not invent an open exit",
);

// Reproduce the potato recording at shack_02 local position (-3, 3). The
// objective is southeast, while the only opening is the four-unit gap in the
// north wall. Player clearance leaves a narrow but legal 1.6-unit corridor.
const shackWalls: NavigationBlocker[] = [
    aabb(301, -4, -3, -2, -2),
    aabb(302, 2, -3, 4, -2),
    aabb(303, -5, -3, -4, 5),
    aabb(304, 4, -3, 5, 5),
    aabb(305, -4, 4, 4, 5),
];
const recordedShackExit = selectOpenBoundaryExit(
    { x: -3, y: 3 },
    { x: 162, y: 99 },
    (point) => point.x >= -5.65 && point.x <= 5.65
        && point.y >= -3.65 && point.y <= 5.65,
    (start, end) => isNavigationSegmentClear(start, end, shackWalls, 0.82),
    {
        angleSteps: 96,
        probeDistances: [4, 6, 8.5, 11, 15],
        isStandable: (point) => isNavigationSegmentClear(point, point, shackWalls, 0.82),
    },
);
assert(recordedShackExit, "the recorded shack_02 position must have a navigable exit");
assert(
    recordedShackExit.y < -3.65 && Math.abs(recordedShackExit.x) < 1.9,
    "the recorded replay must select shack_02's real north opening",
);

const orderedProbes = buildIndoorSearchProbes(
    [
        { min: { x: -1, y: -1 }, max: { x: 1, y: 1 } },
        { min: { x: 19, y: -1 }, max: { x: 21, y: 1 } },
    ],
    { x: 10, y: 0 },
    1.15,
    { x: 0, y: 0 },
    (_cursor, next) => (next.x > 10 ? 1 : 100),
);
assert(
    orderedProbes[0].x > 10,
    "indoor room sweep ordering must honor route cost rather than Euclidean wall distance",
);

const smartBotSource = fs.readFileSync(path.join(import.meta.dirname, "smartBot.ts"), "utf8");
assert(smartBotSource.includes("recoverIndoorPortalRoute("));
assert(smartBotSource.includes("indoorPortalPreviewCache"));
assert(smartBotSource.includes("pointPenalty: sameRoof"));
assert(smartBotSource.includes('type: "indoor_route_recovery"'));
assert(smartBotSource.includes("this.advanceIndoorSearchProbe(timestamp)"));
assert(smartBotSource.includes("openIndoorBoundaryExit("));
assert(smartBotSource.includes("timestamp < this.unstuckUntil || timestamp < this.roomEscapeUntil"));
assert(
    smartBotSource.includes("!sameIndoorBuilding"),
    "same-building stalls must not fall through to exterior room escape",
);

console.log("Indoor navigation R2 smoke test passed");
