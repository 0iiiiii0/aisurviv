import assert from "assert";

import { GunDefs } from "../../shared/defs/gameObjects/gunDefs.ts";
import { FactionCoordinator } from "./bot/factionStrategy.ts";
import {
    AMMO_REQUEST_EMOTE_TO_TYPE,
    INTEGRATED_ARBITER_ORDER,
    INTEGRATED_MAX_RESOURCE_HITS,
    INTEGRATED_WEAPON_TIER_SCORE,
    UNARMED_PRIORITY_MULTIPLIER,
    ammoTypeForRequestEmote,
    canDropRequestedAmmo,
    decideCrateThreat,
    giftEmoteForAmmo,
    integratedWeaponTier,
    integratedWeaponTierScore,
    isUtilityOnlyWeapon,
    isVaultControlPanel,
    predictedAmmoDropAmount,
    shouldHandleGeneralFlare,
    type IntegratedWeaponTier,
} from "./bot/integratedLogicSpec.ts";

assert.deepEqual(INTEGRATED_ARBITER_ORDER, [
    "mouseLen_clamp",
    "lethal_gas",
    "enemy_meleeing_me",
    "crate_threat_B",
    "ammo_share",
    "flare",
    "safe_heal",
    "unarmed_gun_hunt",
    "mode_branch",
    "engage_or_rotate",
]);
assert.deepEqual(UNARMED_PRIORITY_MULTIPLIER, {
    groundGun: 3,
    lootContainer: 2.25,
    vaultPanel: 2,
    fight: 0.15,
});
assert.equal(INTEGRATED_MAX_RESOURCE_HITS, 48);

const expectedTiers: Record<IntegratedWeaponTier, readonly string[]> = {
    "S+": ["Rainbow Blaster", "AWM-S", "USAS-12", "Super 90", "M134", "Potato Cannon", "M79"],
    S: [
        "SV-98",
        "Mosin-Nagant",
        "M4A1-S",
        "Mk 20 SSR",
        "M249",
        "Saiga-12",
        "SPAS-12",
        "Lasr Gun",
        "Heart Cannon",
        "Flamethrower",
        "Spud Gun",
    ],
    A: [
        "M1 Garand",
        "L86A2",
        "SVD-63",
        "Mk45G",
        "SCAR-H",
        "Groza-S",
        "Groza",
        "AN-94",
        "QBB-97",
        "PKP Pecheneg",
        "PKM",
        "BAR M1918",
        "Vector (.45 ACP)",
        "Vector (9mm)",
        "CZ-3A1",
        "MP220",
        "Hawk 12G",
        "P30L",
        "DEagle 50",
    ],
    B: [
        "AK-47",
        "M416",
        "FAMAS",
        "DP-28",
        "M39 EMR",
        "Mk 12 SPR",
        "VSS",
        "Scout Elite",
        "BLR-81",
        "M870",
        "M1100",
        "MAC-10",
        "M1A1",
        "UMP9",
        "MP5",
        "Peacemaker",
        "OTs-38",
    ],
    C: ["G18C", "M93R", "OT-38", "M1911", "Model 94"],
    D: ["M9", "M9 Cursed", "Water Gun"],
    F: ["Flare Gun", "Bugle"],
};

for (const [tier, names] of Object.entries(expectedTiers) as Array<[IntegratedWeaponTier, readonly string[]]>) {
    for (const name of names) {
        assert.equal(integratedWeaponTier("", name), tier, name);
        assert.equal(integratedWeaponTierScore("", name), INTEGRATED_WEAPON_TIER_SCORE[tier]);
    }
}

// Validate the project-specific internal aliases, especially duplicate display names.
assert.equal(integratedWeaponTier("vector", GunDefs.vector.name), "A");
assert.equal(integratedWeaponTier("vector45", GunDefs.vector45.name), "A");
assert.equal(integratedWeaponTier("hk416", GunDefs.hk416.name), "B");
assert.equal(integratedWeaponTier("awc", GunDefs.awc.name), "S+");
assert.equal(integratedWeaponTier("bugle", GunDefs.bugle.name), "F");
assert.equal(isUtilityOnlyWeapon("flare_gun", "Flare Gun"), true);
assert.equal(isUtilityOnlyWeapon("ak47", "AK-47"), false);

assert.equal(Object.keys(AMMO_REQUEST_EMOTE_TO_TYPE).length, 8);
assert.equal(ammoTypeForRequestEmote("emote_ammo556mm"), "556mm");
assert.equal(ammoTypeForRequestEmote("emote_ammoflare"), "flare");
assert.equal(ammoTypeForRequestEmote("emote_ammo", "", "556mm"), "556mm");
assert.equal(ammoTypeForRequestEmote("emote_ammo", "762mm", "9mm"), "762mm");
assert.equal(ammoTypeForRequestEmote("emote_ammo", "", ""), null);
assert.equal(ammoTypeForRequestEmote("emote_happyface"), null);
assert.equal(giftEmoteForAmmo("556mm"), "ping_help");
assert.equal(giftEmoteForAmmo("308sub"), "ping_help");
assert.notEqual(giftEmoteForAmmo("9mm"), "ping_coming");
assert.equal(giftEmoteForAmmo("9mm"), "ping_help");
assert.equal(predictedAmmoDropAmount(90), 45);
assert.equal(predictedAmmoDropAmount(5), 5);
assert.equal(predictedAmmoDropAmount(7, 10), 7);
assert.equal(canDropRequestedAmmo({ inventoryCount: 90, ownWeaponUsesAmmo: true, ownMagazineSize: 30 }), true);
assert.equal(canDropRequestedAmmo({ inventoryCount: 40, ownWeaponUsesAmmo: true, ownMagazineSize: 30 }), false);
assert.equal(canDropRequestedAmmo({ inventoryCount: 12, ownWeaponUsesAmmo: false, ownMagazineSize: 30 }), true);

assert.equal(decideCrateThreat({ enemyMeleeingMe: true, meHasGun: false, enemyHasGun: false }), "combat");
assert.equal(decideCrateThreat({ enemyMeleeingMe: false, meHasGun: true, enemyHasGun: false }), "combat");
assert.equal(decideCrateThreat({ enemyMeleeingMe: false, meHasGun: false, enemyHasGun: true }), "flee");
assert.equal(decideCrateThreat({ enemyMeleeingMe: false, meHasGun: false, enemyHasGun: false }), "continue-crate");

const panelDefinition = { button: { useType: "vault_door" } };
assert.equal(isVaultControlPanel("control_panel_01", panelDefinition, { canUse: true, onOff: false }), true);
assert.equal(isVaultControlPanel("control_panel_01", panelDefinition, { canUse: false, onOff: false }), false);
assert.equal(isVaultControlPanel("control_panel_01", panelDefinition, { canUse: true, onOff: true }), false);
assert.equal(isVaultControlPanel("crate_01", panelDefinition, { canUse: true, onOff: false }), false);

assert.equal(shouldHandleGeneralFlare({
    hasFlareGun: true,
    flareAmmo: 1,
    enemyDistance: 60,
    outsideGas: false,
    underAirstrike: false,
    indoors: false,
    currentPhase: "early",
}), "fire");
assert.equal(shouldHandleGeneralFlare({
    hasFlareGun: true,
    flareAmmo: 0,
    enemyDistance: 60,
    outsideGas: false,
    underAirstrike: false,
    indoors: false,
    currentPhase: "early",
}), "drop-empty");
assert.equal(shouldHandleGeneralFlare({
    hasFlareGun: true,
    flareAmmo: 1,
    enemyDistance: 10,
    outsideGas: false,
    underAirstrike: false,
    indoors: false,
    currentPhase: "early",
}), "wait");

const faction = new FactionCoordinator({ enabled: true });
faction.reportAmmoNeed({
    key: "bot:2",
    requesterBotId: 2,
    requesterPlayerId: 202,
    teamId: 1,
    ammoType: "556mm",
    pos: { x: 10, y: 10 },
    human: false,
    firstObservedAt: 1000,
    updatedAt: 1000,
});
const firstFactionShare = faction.claimAmmoShare({
    teamId: 1,
    donorBotId: 1,
    donorPos: { x: 11, y: 10 },
    availableAmmoTypes: new Set(["556mm"]),
    timestamp: 1100,
    allowMultipleHumanDonors: true,
});
assert.equal(firstFactionShare?.key, "bot:2");
assert.equal(faction.claimAmmoShare({
    teamId: 1,
    donorBotId: 3,
    donorPos: { x: 11, y: 10 },
    availableAmmoTypes: new Set(["556mm"]),
    timestamp: 1150,
    allowMultipleHumanDonors: true,
}), null, "bot-to-bot blackboard must reserve one donor");
faction.releaseAmmoShare(1, "bot:2", 1);
assert.equal(faction.claimAmmoShare({
    teamId: 1,
    donorBotId: 3,
    donorPos: { x: 11, y: 10 },
    availableAmmoTypes: new Set(["556mm"]),
    timestamp: 1200,
    allowMultipleHumanDonors: true,
})?.key, "bot:2");

faction.reportAmmoNeed({
    key: "human:303:762mm",
    requesterBotId: 0,
    requesterPlayerId: 303,
    teamId: 1,
    ammoType: "762mm",
    pos: { x: 20, y: 20 },
    human: true,
    firstObservedAt: 1300,
    updatedAt: 1300,
});
for (const donorBotId of [4, 5]) {
    assert.equal(faction.claimAmmoShare({
        teamId: 1,
        donorBotId,
        donorPos: { x: 21, y: 20 },
        availableAmmoTypes: new Set(["762mm"]),
        timestamp: 1350,
        allowMultipleHumanDonors: true,
        excludedKeys: new Set(["bot:2"]),
    })?.key, "human:303:762mm", "50v50 human requests allow multiple donors");
}

console.log("Full integrated logic specification smoke test passed");
