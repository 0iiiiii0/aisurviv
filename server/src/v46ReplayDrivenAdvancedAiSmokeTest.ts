import assert from "node:assert/strict";

import {
    assessAirstrikeThreat,
    type AirstrikeZoneState,
} from "./bot/airstrikeEvasion.ts";
import {
    evaluateDualSwitch,
    isDualSwitchDestinationInRange,
    shouldPrioritizeDualSwitchBeforeReload,
} from "./bot/dualSwitch.ts";

// Regression reconstructed from match 97dd297a. The bot was about 42 units
// from the warning center (roughly 24 units outside its complete footprint)
// but repeatedly left combat for airstrike escape and died during the churn.
const replayTimestamp = 1_785_228_917_500;
const replayStrike: AirstrikeZoneState = {
    pos: { x: 88.7, y: 68.5 },
    rad: 18,
    highDamageRad: 12.2,
    impactInMs: 0,
    updatedAt: replayTimestamp,
    expiresAt: replayTimestamp + 4_000,
};

assert.equal(
    assessAirstrikeThreat({ x: 131, y: 72 }, [replayStrike], replayTimestamp),
    null,
    "a safely outside bot must keep combat attention when the distant strike lands",
);

const nearEdgeThreat = assessAirstrikeThreat(
    { x: replayStrike.pos.x + replayStrike.rad + 2, y: replayStrike.pos.y },
    [replayStrike],
    replayTimestamp,
);
assert.ok(nearEdgeThreat, "the small blast/prediction margin must remain tracked");
assert.equal(nearEdgeThreat!.highestPriority, false);

const coreThreat = assessAirstrikeThreat(
    { x: replayStrike.pos.x + 4, y: replayStrike.pos.y },
    [replayStrike],
    replayTimestamp,
);
assert.ok(coreThreat?.highestPriority, "an imminent core strike must still pre-empt combat");

// The recordings also showed sniper/shotgun cycles being armed at rifle range,
// then cancelled as soon as the real shotgun range was checked.
assert.equal(isDualSwitchDestinationInRange(42, 27), false);
assert.equal(isDualSwitchDestinationInRange(18, 27), true);

const sniperShotgun = {
    difficulty: "legit",
    currentType: "mosin",
    otherType: "spas12",
    currentCooldown: 1.75,
    otherCooldown: 0,
    otherAmmo: 5,
    otherInRange: false,
    currentFireMode: "single",
    otherFireMode: "single",
    currentFireDelay: 1.75,
    otherFireDelay: 0.9,
    currentMaxClip: 5,
    currentBulletCount: 1,
    otherBulletCount: 9,
    currentRange: 86,
    otherRange: 27,
    targetDistance: 42,
    switchDelay: 0.9,
    shotConfirmed: true,
};
assert.equal(
    evaluateDualSwitch(sniperShotgun).reason,
    "range",
    "an out-of-range shotgun follow-up must never be armed",
);
assert.equal(
    evaluateDualSwitch({
        ...sniperShotgun,
        otherInRange: true,
        targetDistance: 18,
    }).useful,
    true,
    "the same high-level cycle must remain available at effective range",
);

assert.equal(
    shouldPrioritizeDualSwitchBeforeReload({
        plannedSlot: 1,
        currentSlot: 0,
        reloadActive: false,
    }),
    true,
    "a valid confirmed-shot cycle should happen before an optional reload",
);
assert.equal(
    shouldPrioritizeDualSwitchBeforeReload({
        plannedSlot: 1,
        currentSlot: 0,
        reloadActive: true,
    }),
    false,
    "an authoritative reload already in progress must not be interrupted",
);

console.log(
    "V46 replay-driven advanced AI smoke test passed: distant airstrike focus, range-aware cycling, and reload priority.",
);
