import assert from "assert";
import {
    evaluateDualSwitch,
    supportsHighLevelDualSwitch,
} from "./bot/dualSwitch.ts";

assert.equal(supportsHighLevelDualSwitch("normal"), false);
assert.equal(supportsHighLevelDualSwitch("hard"), false);
assert.equal(supportsHighLevelDualSwitch("pro"), true);
assert.equal(supportsHighLevelDualSwitch("legit"), true);
assert.equal(supportsHighLevelDualSwitch("forbidden"), true);

const mosinSv98 = {
    difficulty: "forbidden",
    currentType: "mosin",
    otherType: "sv98",
    currentCooldown: 1.72,
    otherCooldown: 0,
    otherAmmo: 10,
    otherInRange: true,
    currentFireMode: "single",
    otherFireMode: "single",
    currentFireDelay: 1.75,
    otherFireDelay: 1.5,
    currentMaxClip: 5,
    currentDeployGroup: 0,
    otherDeployGroup: 0,
    switchDelay: 1,
    shotConfirmed: true,
};

assert.equal(evaluateDualSwitch(mosinSv98).useful, true);
assert.equal(
    evaluateDualSwitch({ ...mosinSv98, shotConfirmed: false }).reason,
    "unconfirmed-shot",
);
assert.equal(
    evaluateDualSwitch({ ...mosinSv98, otherCooldown: 0.4 }).useful,
    true,
    "the destination cooldown is replaced by the legal deploy delay",
);
assert.equal(
    evaluateDualSwitch({ ...mosinSv98, otherInRange: false }).reason,
    "range",
);
assert.equal(
    evaluateDualSwitch({ ...mosinSv98, difficulty: "hard" }).reason,
    "difficulty",
);
assert.equal(
    evaluateDualSwitch({
        ...mosinSv98,
        currentType: "ak47",
        otherType: "mp5",
        currentFireMode: "auto",
        otherFireMode: "auto",
        currentFireDelay: 0.1,
        otherFireDelay: 0.08,
        currentMaxClip: 30,
    }).reason,
    "fire-mode",
);
assert.equal(
    evaluateDualSwitch({
        ...mosinSv98,
        otherType: "potato_cannon",
        otherIsLauncher: true,
    }).reason,
    "utility",
);
assert.equal(
    evaluateDualSwitch({
        ...mosinSv98,
        currentCooldown: 1.02,
        switchDelay: 1,
    }).reason,
    "no-advance",
);

console.log("Dual-switch smoke test passed: confirmed-shot gating, pair eligibility, readiness and utility exclusions.");

const sniperShotgun = {
    ...mosinSv98,
    currentType: "mosin",
    otherType: "m870",
    currentCooldown: 1.75,
    otherCooldown: 0,
    otherAmmo: 5,
    currentFireDelay: 1.75,
    otherFireDelay: 0.9,
    currentMaxClip: 5,
    currentBulletCount: 1,
    otherBulletCount: 9,
    currentRange: 86,
    otherRange: 27,
    targetDistance: 18,
    switchDelay: 0.9,
};
assert.equal(
    evaluateDualSwitch(sniperShotgun).useful,
    true,
    "a precision rifle should quick-switch to an in-range pump shotgun",
);
assert.equal(
    evaluateDualSwitch({ ...sniperShotgun, otherInRange: false }).reason,
    "range",
    "the shotgun half of the cycle must stay within its real range",
);
assert.equal(
    evaluateDualSwitch({
        ...sniperShotgun,
        currentType: "m870",
        otherType: "mosin",
        currentCooldown: 0.9,
        otherCooldown: 0,
        currentFireDelay: 0.9,
        otherFireDelay: 1.75,
        currentBulletCount: 9,
        otherBulletCount: 1,
        currentRange: 27,
        otherRange: 86,
        switchDelay: 1,
    }).useful,
    true,
    "the committed shotgun shot should cycle back to the precision rifle",
);
