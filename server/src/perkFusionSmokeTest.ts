import assert from "node:assert/strict";
import fs from "node:fs";
import { PerkDefs } from "../../shared/defs/gameObjects/perkDefs.ts";
import {
    fusePermanentPerks,
    permanentPerkFusionPool,
} from "./economy/shopManager.ts";
import { getServerDataFilePath } from "./config.ts";
import { StashManager, stackCap } from "./stash/stashManager.ts";

const testFileName = "survivio-stash-perk-fusion-test.json";
const testFile = getServerDataFilePath(testFileName);
for (const suffix of ["", ".bak", ".lock"]) {
    fs.rmSync(`${testFile}${suffix}`, { recursive: true, force: true });
}

// StashManager transaction tests use an isolated data file. The exported shop
// wrapper is separately checked against the production singleton at the end.
const stash = new StashManager(testFileName);
const player = "PERMANENT-FUSION-SMOKE";

try {
    // Different permanent materials: inventory decreases by one net item and
    // the independent one-time inventory is untouched.
    stash.addItem(player, "firepower", 1);
    stash.addItem(player, "steelskin", 1);
    stash.buyOneTimePerk(player, "windwalk", 0);
    stash.buyOneTimePerk(player, "windwalk", 0);
    const oneTimeBefore = [...(stash.getStash(player).oneTimePerks ?? [])];
    const permanentBeforeOneTimeAttempt = {
        ...stash.getStash(player).items.perks,
    };
    const oneTimeOnlyAttempt = stash.fusePermanentPerks(
        player,
        ["windwalk", "windwalk"],
        ["targeting"],
        () => 0,
    );
    assert.equal(oneTimeOnlyAttempt.ok, false);
    assert.equal(oneTimeOnlyAttempt.reason, "not-enough");
    assert.deepEqual(
        stash.getStash(player).items.perks,
        permanentBeforeOneTimeAttempt,
    );
    assert.deepEqual(stash.getStash(player).oneTimePerks, oneTimeBefore);

    const first = stash.fusePermanentPerks(
        player,
        ["firepower", "steelskin"],
        ["targeting"],
        () => 0,
    );
    assert.equal(first.ok, true);
    assert.deepEqual(first.perks, { targeting: 1 });
    assert.deepEqual(stash.getStash(player).oneTimePerks, oneTimeBefore);

    // Same-type fusion consumes exactly two permanent copies.
    stash.addItem(player, "firepower", 2);
    const same = stash.fusePermanentPerks(
        player,
        ["firepower", "firepower"],
        ["leadership"],
        () => 0,
    );
    assert.equal(same.ok, true);
    assert.equal(same.perks?.firepower, undefined);
    assert.equal(same.perks?.leadership, 1);

    // If the result type is also a material, two copies become one copy.
    stash.addItem(player, "windwalk", 2);
    const sameAsResult = stash.fusePermanentPerks(
        player,
        ["windwalk", "windwalk"],
        ["windwalk"],
        () => 0,
    );
    assert.equal(sameAsResult.ok, true);
    assert.equal(sameAsResult.perks?.windwalk, 1);

    // Once a selected permanent perk was deducted into pending, the loadout
    // label must not reserve a second warehouse copy during fusion.
    stash.addItem(player, "splinter", 2);
    stash.addItem(player, "firepower", 1);
    stash.setLoadout(player, {
        guns: [],
        ammo: {},
        consumables: {},
        armor: {},
        perks: ["splinter"],
    });
    assert.deepEqual(stash.grantLoadout(player)?.perks, ["splinter"]);
    assert.equal(stash.getStash(player).items.perks.splinter, 1);
    const saveDuringPending = stash.setLoadout(player, {
        guns: [],
        ammo: {},
        consumables: {},
        armor: {},
        perks: ["splinter"],
    });
    assert.deepEqual(saveDuringPending.loadout?.perks, ["splinter"]);
    const pendingDoesNotDoubleReserve = stash.fusePermanentPerks(
        player,
        ["splinter", "firepower"],
        ["targeting"],
        () => 0,
    );
    assert.equal(pendingDoesNotDoubleReserve.ok, true);
    assert.equal(pendingDoesNotDoubleReserve.perks?.splinter, undefined);
    assert.equal(stash.recoverPendingGrant(player), true);
    assert.equal(stash.getStash(player).items.perks.splinter, 1);

    // A selected permanent copy is reserved and cannot be consumed.
    stash.addItem(player, "steelskin", 1);
    stash.addItem(player, "firepower", 1);
    stash.setLoadout(player, {
        guns: [],
        ammo: {},
        consumables: {},
        armor: {},
        perks: ["steelskin"],
    });
    const beforeEquipped = { ...stash.getStash(player).items.perks };
    const equipped = stash.fusePermanentPerks(
        player,
        ["steelskin", "firepower"],
        ["targeting"],
        () => 0,
    );
    assert.equal(equipped.ok, false);
    assert.equal(equipped.reason, "equipped");
    assert.deepEqual(stash.getStash(player).items.perks, beforeEquipped);

    // Full result stacks are filtered inside the same locked transaction before
    // random selection, so a failed roll cannot be retried to manipulate odds.
    stash.setLoadout(player, {
        guns: [],
        ammo: {},
        consumables: {},
        armor: {},
        perks: [],
    });
    stash.setItem(player, "targeting", stackCap("targeting"));
    let eligiblePoolLength = 0;
    const filteredFullStack = stash.fusePermanentPerks(
        player,
        ["steelskin", "firepower"],
        ["targeting", "leadership"],
        (length) => {
            eligiblePoolLength = length;
            return 0;
        },
    );
    assert.equal(filteredFullStack.ok, true);
    assert.equal(eligiblePoolLength, 1);
    assert.equal(filteredFullStack.resultType, "leadership");

    stash.addItem(player, "steelskin", 1);
    stash.addItem(player, "firepower", 1);
    const beforeAllFull = { ...stash.getStash(player).items.perks };
    const allFull = stash.fusePermanentPerks(
        player,
        ["steelskin", "firepower"],
        ["targeting"],
        () => 0,
    );
    assert.equal(allFull.ok, false);
    assert.equal(allFull.reason, "stack-full");
    assert.deepEqual(stash.getStash(player).items.perks, beforeAllFull);

    // Failed and invalid requests are atomic and still cannot consume the two
    // one-time Windwalk copies.
    assert.equal(
        stash.fusePermanentPerks(
            player,
            ["halloween_mystery", "firepower"],
            ["targeting"],
            () => 0,
        ).reason,
        "not-enough",
    );
    assert.deepEqual(stash.getStash(player).oneTimePerks, oneTimeBefore);

    // Both inventories survive a fresh manager instance without crossing over.
    const rebooted = new StashManager(testFileName);
    assert.deepEqual(rebooted.getStash(player).oneTimePerks, oneTimeBefore);
    assert.equal(rebooted.getStash(player).items.perks.windwalk, 1);

    const pool = permanentPerkFusionPool();
    assert(pool.length > 0);
    assert(pool.every((type) => Boolean(PerkDefs[type])));
    for (const excluded of [
        "halloween_mystery",
        "scavenger",
        "scavenger_adv",
        "trick_nothing",
        "treat_9mm",
    ]) {
        assert.equal(pool.includes(excluded), false, `${excluded} excluded`);
    }

    // The public wrapper validates request size and material IDs before it can
    // touch the production singleton.
    assert.equal(fusePermanentPerks(player, ["firepower"]).reason, "invalid-materials");
    assert.equal(
        fusePermanentPerks(player, ["halloween_mystery", "firepower"]).reason,
        "invalid-materials",
    );
    console.log("Permanent perk fusion smoke test passed");
} finally {
    for (const suffix of ["", ".bak", ".lock"]) {
        fs.rmSync(`${testFile}${suffix}`, { recursive: true, force: true });
    }
}
