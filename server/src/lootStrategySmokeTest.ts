import assert from "assert";

import { GameConfig } from "../../shared/gameConfig.ts";
import {
    isCommonLootFixtureType,
    lootApproachDistance,
    lootBreakableProfile,
    lootPickupDistance,
    meleeBreakDistance,
    resourceBreakPlan,
} from "./bot/lootStrategy.ts";

function main(): void {
    const gunPickup = lootPickupDistance("mp5");
    const ammoPickup = lootPickupDistance("9mm");
    const helmetPickup = lootPickupDistance("helmet01");

    assert(gunPickup < GameConfig.player.maxInteractionRad - 0.35);
    assert(gunPickup > GameConfig.player.radius);
    assert(ammoPickup > GameConfig.player.radius);
    assert(helmetPickup > GameConfig.player.radius);
    assert(lootApproachDistance("mp5") < 1);
    assert(lootApproachDistance("9mm") < 1);
    assert(lootApproachDistance("mp5") < gunPickup);

    for (const fixture of [
        "drawers_01",
        "bookshelf_01",
        "locker_01",
        "toilet_01",
    ]) {
        assert.equal(
            isCommonLootFixtureType(
                fixture,
                lootBreakableProfile(fixture)?.obstacleType,
            ),
            true,
            `${fixture} must be classified as a common loot fixture`,
        );
        assert(
            resourceBreakPlan("fists", fixture)?.feasible,
            `${fixture} must be reachable with the default melee loadout`,
        );
    }

    assert(lootBreakableProfile("crate_01"));
    assert(lootBreakableProfile("barrel_02"));
    assert(lootBreakableProfile("chest_01"));
    assert(lootBreakableProfile("deposit_box_01"));
    assert(lootBreakableProfile("deposit_box_02"));
    assert(lootBreakableProfile("gun_mount_01"));
    assert(lootBreakableProfile("tree_03"));
    assert(lootBreakableProfile("pumpkin_01"));
    assert.equal(
        lootBreakableProfile("potato_01")?.swapWeaponOnDestroy,
        true,
        "potatoes must be recognized as weapon-reroll resources",
    );
    assert.equal(lootBreakableProfile("container_01"), null);
    assert.equal(lootBreakableProfile("barrel_01"), null);
    assert.equal(lootBreakableProfile("bollard_01"), null);

    const depositPlan = resourceBreakPlan("fists", "deposit_box_02");
    assert(depositPlan?.feasible);
    assert.equal(depositPlan.estimatedHits, 1);
    assert(depositPlan.expectedLootValue > (lootBreakableProfile("deposit_box_01")?.expectedLootValue ?? 0));

    const treePlan = resourceBreakPlan("fists", "tree_03");
    assert(treePlan?.feasible);
    assert(treePlan.estimatedHits <= 48);

    const siloPlan = resourceBreakPlan("fists", "silo_01po");
    assert(siloPlan && !siloPlan.feasible);
    assert(siloPlan.estimatedHits > 48);

    const explosivePlan = resourceBreakPlan("fists", "barrel_01b");
    assert(explosivePlan && explosivePlan.dangerous && !explosivePlan.feasible);

    const platedPlan = resourceBreakPlan("fists", "crate_04");
    assert(platedPlan && platedPlan.armorPlated && !platedPlan.feasible);

    const crate = lootBreakableProfile("crate_01");
    assert(crate);
    const fistDistance = meleeBreakDistance("fists", "crate_01");
    const collisionStopDistance = GameConfig.player.radius + crate.contactRadius;
    assert(
        fistDistance > collisionStopDistance,
        `fist attack distance ${fistDistance} must be reachable before collision stop ${collisionStopDistance}`,
    );

    const depositDistance = meleeBreakDistance("fists", "deposit_box_02");
    assert(
        depositDistance >
            GameConfig.player.radius +
                (lootBreakableProfile("deposit_box_02")?.contactRadius ?? 0),
    );

    console.log("Loot/resource search strategy smoke test passed");
}

main();
