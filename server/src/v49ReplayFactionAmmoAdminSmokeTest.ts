import assert from "node:assert/strict";
import { FactionCoordinator } from "./bot/factionStrategy.ts";
import { canDropRequestedAmmo } from "./bot/integratedLogicSpec.ts";
import { lootBreakableProfile } from "./bot/lootStrategy.ts";
import { orderPlayersForStatus } from "./game/gameModeManager.ts";
import "../../client/public/admin/adminInputHelpers.js";

const adminInput = (globalThis as unknown as { SurvivAdminInput: {
    parseDraftNumber: (
        raw: unknown,
        min: number,
        max: number,
        step: number,
    ) => number | null;
    normalizeDraftNumber: (
        raw: unknown,
        fallback: number,
        min: number,
        max: number,
        step: number,
    ) => number;
} }).SurvivAdminInput;

assert.deepEqual(
    orderPlayersForStatus([{ __id: 4208 }, { __id: 4127 }, { __id: 4160 }]).map(
        (player) => player.__id,
    ),
    [4127, 4160, 4208],
    "50v50 status serialization must match the client's sorted player id order",
);

for (const type of ["tree_08f", "stone_01f", "house_window_01"]) {
    assert.equal(
        lootBreakableProfile(type)?.searchLootEligible,
        false,
        `${type} must remain breakable for navigation but never enter loot search`,
    );
}
assert.equal(
    lootBreakableProfile("crate_01")?.searchLootEligible,
    true,
    "real loot crates must remain searchable",
);

assert.equal(adminInput.parseDraftNumber("", 0, 100, 1), null);
assert.equal(adminInput.parseDraftNumber("4", 0, 100, 1), 4);
assert.equal(adminInput.parseDraftNumber("40", 0, 100, 1), 40);
assert.equal(
    adminInput.normalizeDraftNumber("", 20, 0, 100, 1),
    20,
    "clearing a number field must not inject a new value while editing",
);

assert.equal(
    canDropRequestedAmmo({
        inventoryCount: 45,
        ownWeaponUsesAmmo: true,
        ownMagazineSize: 30,
    }),
    false,
    "routine bot sharing keeps a full magazine",
);
assert.equal(
    canDropRequestedAmmo({
        inventoryCount: 45,
        ownWeaponUsesAmmo: true,
        ownMagazineSize: 30,
        reserveMagazineFraction: 0.5,
    }),
    true,
    "human requests may be served while the donor retains half a magazine",
);

const faction = new FactionCoordinator();
faction.reportAmmoNeed({
    key: "human:4127:9mm",
    requesterBotId: 0,
    requesterPlayerId: 4127,
    teamId: 1,
    ammoType: "9mm",
    pos: { x: 10, y: 10 },
    human: true,
    firstObservedAt: 1000,
    updatedAt: 1000,
});
// Repeated request emotes refresh the position without resetting the age. The
// old implementation reset requestAge forever and could permanently exclude
// every donor outside its arbitrary modulo subset.
faction.reportAmmoNeed({
    key: "human:4127:9mm",
    requesterBotId: 0,
    requesterPlayerId: 4127,
    teamId: 1,
    ammoType: "9mm",
    pos: { x: 12, y: 10 },
    human: true,
    firstObservedAt: 5000,
    updatedAt: 5000,
});
faction.reportAmmoNeed({
    key: "bot:99",
    requesterBotId: 99,
    requesterPlayerId: 4999,
    teamId: 1,
    ammoType: "9mm",
    pos: { x: 9, y: 10 },
    human: false,
    firstObservedAt: 5000,
    updatedAt: 5000,
});
const assignment = faction.claimAmmoShare({
    teamId: 1,
    donorBotId: 7,
    donorPos: { x: 11, y: 10 },
    availableAmmoTypes: new Set(["9mm"]),
    timestamp: 5200,
    allowMultipleHumanDonors: false,
    humanOnly: true,
});
assert.equal(assignment?.requesterPlayerId, 4127);
assert.equal(assignment?.firstObservedAt, 1000);

console.log(
    "V49 replay fixes passed: deterministic faction status order, editable admin numbers, loot-only search, and reliable human ammo response.",
);
