import assert from "assert";
import {
    beginOrExtendOpeningResourceSweep,
    emptyOpeningResourceSweep,
    openingResourceSweepActive,
    openingResourceSweepContains,
    openingResourceSweepScoreBonus,
    OPENING_RESOURCE_SWEEP_MAX_MS,
} from "./bot/resourceSweep.ts";

const start = 10_000;
let sweep = beginOrExtendOpeningResourceSweep(
    emptyOpeningResourceSweep(),
    { x: 100, y: 100 },
    90,
    "early",
    start,
);
assert.ok(openingResourceSweepActive(sweep, "early", start + 1));
assert.ok(openingResourceSweepContains(sweep, { x: 112, y: 100 }, "early", start + 1));
assert.ok(!openingResourceSweepContains(sweep, { x: 150, y: 100 }, "early", start + 1));
assert.ok(
    openingResourceSweepScoreBonus(sweep, { x: 105, y: 100 }, "early", start + 1) >
        openingResourceSweepScoreBonus(sweep, { x: 150, y: 100 }, "early", start + 1),
);

const originalStart = sweep.startedAt;
sweep = beginOrExtendOpeningResourceSweep(
    sweep,
    { x: 118, y: 103 },
    40,
    "early",
    start + 5000,
);
assert.equal(sweep.startedAt, originalStart, "nearby resources should extend the same sweep");
assert.ok(sweep.expiresAt <= originalStart + OPENING_RESOURCE_SWEEP_MAX_MS);
assert.ok(!openingResourceSweepActive(sweep, "mid", start + 5001));
assert.ok(!openingResourceSweepActive(sweep, "early", originalStart + OPENING_RESOURCE_SWEEP_MAX_MS + 1));

console.log("Opening resource sweep smoke test passed");
