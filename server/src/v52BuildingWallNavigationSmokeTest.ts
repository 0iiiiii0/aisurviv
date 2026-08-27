import assert from "assert";
import fs from "fs";
import path from "path";
import {
    planLocalSteering,
    pointInsideNavigationCollision,
    segmentIntersectsNavigationCollision,
    type NavigationBlocker,
} from "./bot/navigationController.ts";
import {
    pointInsideConcealment,
    type ConcealmentZone,
} from "./bot/concealmentIntelligence.ts";
import { buildIndoorSearchProbes } from "./bot/indoorSearch.ts";

const wall: NavigationBlocker = {
    id: 91,
    pos: { x: 5, y: 0 },
    radius: 5.2,
    collision: {
        type: 1,
        min: { x: 4.4, y: -5 },
        max: { x: 5.6, y: 5 },
    },
};

assert(
    segmentIntersectsNavigationCollision(
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        wall.collision!,
    ),
    "the exact long wall must block a direct segment",
);
const aroundWall = planLocalSteering(
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    [wall],
    { clearance: 0.9, preferredSide: 1 },
);
assert(aroundWall.blocked && aroundWall.blockerId === wall.id);
assert(
    Math.abs(aroundWall.waypoint.y) > 5,
    "AABB steering must route around a wall end rather than around its center circle",
);
assert(
    !pointInsideNavigationCollision(aroundWall.waypoint, wall.collision!),
    "wall avoidance waypoint must not be inside the wall",
);

const fromInside = planLocalSteering(
    { x: 5, y: 0 },
    { x: 10, y: 0 },
    [wall],
    { clearance: 0.75 },
);
assert(fromInside.blocked);
assert(
    !pointInsideNavigationCollision(fromInside.waypoint, wall.collision!),
    "a bot already overlapping a wall must be directed outside it",
);

const roof: ConcealmentZone = {
    key: "roof:7",
    kind: "roof",
    center: { x: 10, y: 10 },
    radius: 12,
    layer: 0,
    objectId: 0,
    buildingId: 7,
    destructible: false,
    healthT: 1,
    ceilingDead: false,
    ceilingDamaged: false,
    occupied: false,
    supportIds: [],
    regions: [
        { min: { x: 4, y: 7 }, max: { x: 16, y: 13 } },
        { min: { x: 8, y: 13 }, max: { x: 12, y: 18 } },
    ],
};
assert(pointInsideConcealment({ x: 5, y: 8 }, roof));
assert(pointInsideConcealment({ x: 10, y: 16 }, roof));
assert(
    !pointInsideConcealment({ x: 2, y: 10 }, roof),
    "exact roof regions must reject points that only fit the old bounding circle",
);

const probes = buildIndoorSearchProbes(roof.regions, roof.center);
assert(probes.length >= 6, "large multi-room buildings need several search probes");
assert(
    probes.every((probe) => pointInsideConcealment(probe, roof)),
    "every indoor search probe must remain inside an exact building region",
);

const smartBotSource = fs.readFileSync(path.join(import.meta.dirname, "smartBot.ts"), "utf8") + "\n" + fs.readFileSync(path.join(import.meta.dirname, "bot", "smartBotSupport.ts"), "utf8");
assert(smartBotSource.includes("evaluateGunfireWallSafety("));
assert(smartBotSource.includes('type: "gunfire_wall_blocked"'));
assert(
    smartBotSource.indexOf("evaluateGunfireWallSafety(", smartBotSource.indexOf("private sendInputs")) > 0,
    "sendInputs must revalidate the live ballistic ray before every packet",
);
assert(smartBotSource.includes("MapObjectDefs[type] as AnyDef | undefined"));
assert(smartBotSource.includes("buildIndoorSearchProbes("));
assert(smartBotSource.includes("this.indoorSearchRouteCost(from, target, timestamp)"));

console.log("V52 building wall/navigation smoke test passed");
