import assert from "node:assert/strict";
import { MapNavigator, type MapRuntimeSnapshot } from "./bot/mapStrategy.ts";

const makeSnapshot = (mapName: string, seed: number): MapRuntimeSnapshot => ({
    mapName,
    seed,
    width: 1024,
    height: 1024,
    shoreInset: 8,
    grassInset: 12,
    rivers: [
        {
            width: 4,
            looped: false,
            points: [
                { x: 0, y: 0 },
                { x: 100, y: 40 },
                { x: 220, y: 90 },
            ],
        },
    ],
    places: [{ name: "Crates", pos: { x: 300, y: 200 } }],
    objects: Array.from({ length: 400 }, (_, index) => ({
        pos: { x: (index * 2) % 900, y: (index * 3) % 700 },
        scale: 1,
        type: index % 3 === 0 ? "building" : index % 3 === 1 ? "tree" : "fence",
        ori: index % 4,
    })),
    groundPatches: [],
});

const ordinary = (): MapNavigator => {
    const navigator = new MapNavigator();
    navigator.useSharedAnalysis = true;
    return navigator;
};

const highPerformance = (): MapNavigator => {
    const navigator = new MapNavigator();
    navigator.useSharedAnalysis = false;
    return navigator;
};

// 1. Ordinary AI bots in the same (mapName, seed) share one map snapshot.
const first = ordinary();
const second = ordinary();
first.load(makeSnapshot("main", 7));
second.load(makeSnapshot("main", 7));
assert.equal(
    first.snapshot,
    second.snapshot,
    "ordinary AI must share the same map snapshot for the same (mapName, seed)",
);
assert.equal(
    first.summary(),
    second.summary(),
    "shared analysis must produce the same profile summary",
);

// 2. A different seed keeps a separate analysis.
const otherSeed = ordinary();
otherSeed.load(makeSnapshot("main", 8));
assert.notEqual(
    first.snapshot,
    otherSeed.snapshot,
    "a different seed must not reuse the cached snapshot",
);

// 3. High-performance AI keeps its own independent copy with identical data.
const hp = highPerformance();
hp.load(makeSnapshot("main", 7));
assert.notEqual(
    first.snapshot,
    hp.snapshot,
    "high-performance AI must keep an independent map snapshot",
);
assert.equal(first.snapshot.objects.length, hp.snapshot.objects.length);
assert.deepEqual(first.snapshot.objects[3], hp.snapshot.objects[3]);
assert.equal(first.summary(), hp.summary());

// 4. The shared cache stays bounded: after the LRU cap the oldest entry is
//    rebuilt instead of retained forever.
//    Uses its own map name so earlier test cases do not affect insertion order.
const firstPass = ordinary();
firstPass.load(makeSnapshot("cache-test", 1));
for (let seed = 2; seed <= 9; seed += 1) {
    ordinary().load(makeSnapshot("cache-test", seed));
}
const reloaded = ordinary();
reloaded.load(makeSnapshot("cache-test", 1));
assert.notEqual(
    firstPass.snapshot,
    reloaded.snapshot,
    "the oldest cached analysis must be evicted once the LRU cap is exceeded",
);

// 5. Selecting a resource area is not the same as visiting it. Repeated
// planning must retain an unvisited target; once the bot actually reaches or
// abandons that area, the spatial visit memory must choose the other cluster
// even when the scatter point fell in an adjacent 34-unit cell.
const resourceSearch = highPerformance();
resourceSearch.load({
    mapName: "potato",
    seed: 1_353_707_447,
    width: 300,
    height: 300,
    shoreInset: 0,
    grassInset: 0,
    rivers: [],
    places: [],
    groundPatches: [],
    objects: [
        { type: "crate_01", pos: { x: 80, y: 100 }, scale: 1, ori: 0 },
        { type: "warehouse_02", pos: { x: 80, y: 100 }, scale: 1, ori: 0 },
        { type: "crate_01", pos: { x: 220, y: 100 }, scale: 1, ori: 0 },
        { type: "warehouse_02", pos: { x: 220, y: 100 }, scale: 1, ori: 0 },
    ],
});
const chooseResource = (): { x: number; y: number } =>
    resourceSearch.chooseExploreTarget(
        { x: 150, y: 100 },
        "leader",
        "early",
        null,
        null,
        1_000,
        0,
        7,
        4,
    );
const selectedResource = chooseResource();
assert.deepEqual(
    chooseResource(),
    selectedResource,
    "an unvisited long-distance resource target must remain committed",
);
resourceSearch.markVisited(selectedResource, 1_000);
assert(
    Math.abs(chooseResource().x - selectedResource.x) > 80,
    "arrival/abandonment must move search to a different resource cluster",
);

console.log(
    "Map memory-sharing smoke test passed: ordinary AI shares map analysis per (mapName, seed), high-performance AI stays independent, cache stays bounded.",
);
