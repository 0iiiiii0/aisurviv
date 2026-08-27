import assert from "assert/strict";
import fs from "fs";
import path from "path";
import {
    combatReadiness,
    factionUnarmedCombatPolicy,
    shouldPrioritizeUnarmedCrate,
    unarmedLootRestoresCombat,
    underEquippedEnemyPolicy,
} from "./bot/resourceCombatPolicy.ts";

const base = {
    factionMode: false,
    usableGunCount: 1,
    enemyDistance: 20,
    enemyUsesMelee: false,
    enemyMeleeReach: 0,
};

// 1) A bot without a usable firearm refuses combat in every mode (not just 50v50).
{
    const policy = factionUnarmedCombatPolicy({ ...base, usableGunCount: 0 });
    assert.equal(policy.prioritizeWeaponSearch, true, "unarmed bot must prioritize weapon search");
    assert.equal(policy.allowCombat, false, "unarmed bot must not volunteer for combat");
    const factionPolicy = factionUnarmedCombatPolicy({ ...base, factionMode: true, usableGunCount: 0 });
    assert.equal(factionPolicy.prioritizeWeaponSearch, true);
    assert.equal(factionPolicy.allowCombat, false);
}

// 2) A bot with enough ammo is allowed to fight.
{
    const policy = factionUnarmedCombatPolicy({ ...base, combatAmmoSufficient: true });
    assert.equal(policy.prioritizeWeaponSearch, false, "ammo-sufficient bot must fight");
    assert.equal(policy.allowCombat, true);
}

// 3) A bot whose weapon lacks enough ammo refuses combat and seeks armament.
{
    const policy = factionUnarmedCombatPolicy({ ...base, combatAmmoSufficient: false });
    assert.equal(policy.prioritizeWeaponSearch, true, "low-ammo bot must prioritize finding ammo/weapons");
    assert.equal(policy.allowCombat, false, "low-ammo bot must not volunteer for combat");
}

// 4) Backward compatibility: without combatAmmoSufficient, an armed bot fights.
{
    const policy = factionUnarmedCombatPolicy({ ...base });
    assert.equal(policy.allowCombat, true);
}

// 5) An enemy meleeing the bot is still detected as an immediate threat even
// when the bot is unarmed/low-ammo (self-defense exception).
{
    const policy = factionUnarmedCombatPolicy({
        ...base,
        usableGunCount: 0,
        combatAmmoSufficient: false,
        enemyDistance: 3,
        enemyUsesMelee: true,
        enemyMeleeReach: 4.5,
    });
    assert.equal(policy.immediateMeleeThreat, true);
    assert.equal(policy.allowCombat, false, "self-defense is forced, not voluntary");
}

// 6) Source guarantees for the bot wiring.
const smartBotSource = fs.readFileSync(path.join(__dirname, "smartBot.ts"), "utf8") + "\n" + fs.readFileSync(path.join(__dirname, "bot", "smartBotSupport.ts"), "utf8");
assert.match(smartBotSource, /private hasSufficientCombatAmmo\(\): boolean/, "the bot must own an ammo-sufficiency check");
assert.match(smartBotSource, /combatAmmoSufficient: ammoSufficient,/, "the policy must receive the ammo state");
assert.match(smartBotSource, /forcedMeleeSelfDefense/, "point-blank melee must still force self-defense");
assert.match(smartBotSource, /"evade-and-find-firearm-or-ammo"/, "the weapon search reason must be mode-agnostic");
const policySource = fs.readFileSync(path.join(__dirname, "bot", "resourceCombatPolicy.ts"), "utf8");
assert.match(policySource, /combatAmmoSufficient/, "the policy must understand the ammo state");

// 7) Combat readiness tiers: no gun / weak gun / good gun.
{
    assert.equal(
        combatReadiness({ usableGunCount: 0, bestGunTier: null, combatAmmoSufficient: false }),
        0,
        "no gun -> readiness 0",
    );
    assert.equal(
        combatReadiness({ usableGunCount: 1, bestGunTier: "B", combatAmmoSufficient: false }),
        0,
        "no ammo -> readiness 0",
    );
    assert.equal(
        combatReadiness({ usableGunCount: 1, bestGunTier: "C", combatAmmoSufficient: true }),
        1,
        "C-tier pistol only -> readiness 1 (没有好枪)",
    );
    assert.equal(
        combatReadiness({ usableGunCount: 1, bestGunTier: "D", combatAmmoSufficient: true }),
        1,
        "D-tier -> readiness 1",
    );
    assert.equal(
        combatReadiness({ usableGunCount: 2, bestGunTier: "B", combatAmmoSufficient: true }),
        2,
        "B-tier gun with ammo -> readiness 2",
    );
}

// 8) Under-equipped encounter rules.
{
    // Weak gun vs armed hostile at range: evade, never volunteer.
    const weakVsArmed = underEquippedEnemyPolicy({
        readiness: 1,
        enemyDistance: 16,
        enemyUsesMelee: false,
        enemyMeleeReach: 0,
    });
    assert.equal(weakVsArmed.evade, true, "weak gun must evade an armed hostile");
    assert.equal(weakVsArmed.allowCombat, false, "weak gun must not fight an armed hostile voluntarily");
    assert.equal(weakVsArmed.selfDefenseOnly, true);

    // Weak gun vs melee-only enemy at range: kite and shoot.
    const weakVsMelee = underEquippedEnemyPolicy({
        readiness: 1,
        enemyDistance: 7,
        enemyUsesMelee: true,
        enemyMeleeReach: 4.5,
    });
    assert.equal(weakVsMelee.allowCombat, true, "weak gun can out-range a melee-only enemy");
    assert.equal(weakVsMelee.evade, false);

    // Unarmed vs enemy meleeing us: forced self-defense.
    const unarmedMelee = underEquippedEnemyPolicy({
        readiness: 0,
        enemyDistance: 2.5,
        enemyUsesMelee: true,
        enemyMeleeReach: 4.5,
    });
    assert.equal(unarmedMelee.allowCombat, true, "melee at reach forces self-defense");

    // Unarmed vs armed hostile: full evade.
    const unarmedVsArmed = underEquippedEnemyPolicy({
        readiness: 0,
        enemyDistance: 15,
        enemyUsesMelee: false,
        enemyMeleeReach: 0,
    });
    assert.equal(unarmedVsArmed.evade, true);
    assert.equal(unarmedVsArmed.allowCombat, false);

    // Ready bot: normal combat.
    const ready = underEquippedEnemyPolicy({
        readiness: 2,
        enemyDistance: 10,
        enemyUsesMelee: false,
        enemyMeleeReach: 0,
    });
    assert.equal(ready.evade, false);
    assert.equal(ready.allowCombat, true);
}

// 9) Source guarantees for the new wiring.
{
    const smartBotSource = fs.readFileSync(path.join(__dirname, "smartBot.ts"), "utf8") + "\n" + fs.readFileSync(path.join(__dirname, "bot", "smartBotSupport.ts"), "utf8");
    assert.match(smartBotSource, /combatReadiness\(/, "smartBot must use the readiness tiers");
    assert.match(smartBotSource, /underEquippedEnemyPolicy\(/, "smartBot must use the encounter policy");
    assert.match(smartBotSource, /underEquippedEvade/, "smartBot must track the evade flag");
}

// 10) Readiness 0 resource arbitration: only a gun, matching dry-gun ammo,
// or a genuinely close/efficient container may pre-empt weapon-search.
{
    assert.equal(unarmedLootRestoresCombat({ itemKind: "gun" }), true);
    assert.equal(
        unarmedLootRestoresCombat({
            itemKind: "gun",
            combatCapableGun: false,
        }),
        false,
        "a flare/utility gun must not satisfy first-gun search",
    );
    assert.equal(
        unarmedLootRestoresCombat({
            itemKind: "ammo",
            matchingOwnedGunAmmo: true,
        }),
        true,
        "matching ammo must restore an owned dry firearm",
    );
    for (const itemKind of ["heal", "helmet", "chest", "backpack", "ammo"]) {
        assert.equal(
            unarmedLootRestoresCombat({ itemKind }),
            false,
            `${itemKind} must defer to first-gun search`,
        );
    }

    assert.equal(
        shouldPrioritizeUnarmedCrate({
            distance: 6,
            expectedValue: 32,
            estimatedHits: 10,
            opening: false,
        }),
        true,
        "a close cheap high-value container remains a valid first-gun shortcut",
    );
    assert.equal(
        shouldPrioritizeUnarmedCrate({
            distance: 30,
            expectedValue: 80,
            estimatedHits: 8,
            opening: true,
        }),
        false,
        "a distant container must not replace weapon-search",
    );
    assert.equal(
        shouldPrioritizeUnarmedCrate({
            distance: 5,
            expectedValue: 12,
            estimatedHits: 8,
            opening: true,
        }),
        false,
        "an ordinary low-value fixture must not replace weapon-search",
    );
}

console.log("Combat readiness smoke test passed: unarmed/low-ammo bots refuse combat, point-blank melee still forces self-defense.");
