import assert from "node:assert/strict";
import {
    chooseDuelThrowableKind,
    defensiveSmokeDistance,
} from "./bot/throwableTactics.ts";

const base = {
    hasSmoke: true,
    hasStrobe: true,
    hasMirv: true,
    hasFrag: true,
    difficulty: "legit",
    health: 100,
    enemyDistance: 25,
    underFire: false,
    reloadingOrHealing: false,
    hardCoverNearEnemy: true,
    millisecondsSinceDamage: 5000,
    gasDanger: false,
    airstrikeDanger: false,
};

assert.equal(
    chooseDuelThrowableKind({ ...base, health: 35, underFire: true }),
    "smoke",
    "critical exposed bots must create a smoke screen before attacking",
);
assert.equal(
    chooseDuelThrowableKind({
        ...base,
        health: 52,
        underFire: true,
        reloadingOrHealing: true,
    }),
    "smoke",
    "low-health reload/heal actions must be protected by smoke",
);
assert.equal(
    chooseDuelThrowableKind({ ...base, airstrikeDanger: true }),
    "",
    "a bot must evade an airstrike instead of entering a throwing animation",
);
assert.equal(
    chooseDuelThrowableKind({ ...base, gasDanger: true }),
    "",
    "a bot outside gas must move before using a throwable",
);
assert.equal(
    chooseDuelThrowableKind({ ...base }),
    "strobe",
    "high-level AI should use a strobe to dislodge covered mid-range enemies",
);
assert.equal(
    chooseDuelThrowableKind({ ...base, hasStrobe: false }),
    "mirv",
    "MIRV should cover a distant protected enemy when no strobe is available",
);
assert.equal(
    chooseDuelThrowableKind({
        ...base,
        hasStrobe: false,
        hasMirv: false,
        enemyDistance: 18,
    }),
    "frag",
    "frag should pressure a nearer covered target",
);
assert.equal(
    chooseDuelThrowableKind({
        ...base,
        difficulty: "normal",
        hasMirv: false,
    }),
    "frag",
    "normal AI must not receive the high-level strobe preference",
);
assert.equal(
    chooseDuelThrowableKind({ ...base, millisecondsSinceDamage: 100 }),
    "",
    "offensive throws must be cancelled during immediate incoming damage",
);
assert.equal(defensiveSmokeDistance(10), 3.5);
assert.equal(defensiveSmokeDistance(40), 5.5);

console.log("Throwable tactics smoke test passed: smoke defense, strobe control, MIRV area denial and frag pressure are prioritized safely.");
