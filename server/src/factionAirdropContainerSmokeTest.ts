import assert from "assert/strict";

import { MapObjectDefs } from "../../shared/defs/mapObjectDefs.ts";
import { MapDefs } from "../../shared/defs/mapDefs.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { resourceBreakPlan } from "./bot/lootStrategy.ts";
import { interactionApproachPlan } from "./bot/interactionGeometry.ts";
import {
    isSafeContainerEntryBlocker,
    shippingContainerRoute,
} from "./bot/containerNavigation.ts";

const militaryDrop = MapObjectDefs.airdrop_crate_03 as any;
assert.equal(militaryDrop.airdropCrate, true, "military drop must be recognized as an airdrop crate");
assert.equal(militaryDrop.button?.useOnce, true, "military drop should have one opener interaction");
assert.equal(militaryDrop.button?.destroyOnUse, true, "opening must replace the military shell with its loot crate");
assert.equal(militaryDrop.button?.useDelay, 2.5, "opener must remain committed through the server unlock delay");

// 金空投（airdrop_crate_03 -> crate_12）专属：super90（m1014）与 usas12（usas）。
{
    const goldenShell = MapObjectDefs.airdrop_crate_03 as any;
    const goldenPayload = (MapObjectDefs as Record<string, any>)[goldenShell.destroyType];
    assert.ok(goldenPayload, "golden airdrop shell must have a payload crate");
    const lootTiers = (goldenPayload.loot ?? []).map((l: { tier?: string }) => l.tier);
    assert.ok(
        lootTiers.includes("tier_airdrop_golden_shotguns"),
        "golden airdrop payload must include the golden shotgun tier",
    );
    const shotguns = MapDefs.main.lootTable.tier_airdrop_golden_shotguns ?? [];
    const types = shotguns.map((s: { name: string }) => s.name).sort();
    assert.deepEqual(
        types,
        ["m1014", "usas"],
        "golden shotgun tier must contain super90 (m1014) and usas12 (usas)",
    );
    // 绝密模式空投列表包含金空投；普通搜打撤/主图不受影响。
    const secretCrates = MapDefs.extraction_secret.gameConfig.planes.crates.map(
        (c: { name: string }) => c.name,
    );
    assert.ok(
        secretCrates.includes("airdrop_crate_03"),
        "secret extraction planes must spawn the golden airdrop",
    );
    const normalCrates = MapDefs.extraction.gameConfig.planes.crates.map(
        (c: { name: string }) => c.name,
    );
    assert.ok(
        !normalCrates.includes("airdrop_crate_03"),
        "normal extraction must keep its original airdrop list",
    );
}



const outsideMilitaryShell = interactionApproachPlan({
    definition: militaryDrop as any,
    objectPos: v2.create(100, 100),
    objectOri: 0,
    objectScale: 1,
    actorPos: v2.create(110, 100),
    actorRadius: 0.75,
});
assert.equal(outsideMilitaryShell.canInteract, false);
assert.ok(
    outsideMilitaryShell.approachPoint.x > 104.5 && outsideMilitaryShell.approachPoint.x < 106.5,
    "the opener must approach the metal shell edge instead of steering into its unreachable centre",
);
const atMilitaryShellEdge = interactionApproachPlan({
    definition: militaryDrop as any,
    objectPos: v2.create(100, 100),
    objectOri: 0,
    objectScale: 1,
    actorPos: outsideMilitaryShell.approachPoint,
    actorRadius: 0.75,
});
assert.equal(atMilitaryShellEdge.canInteract, true, "the planned edge point must be inside the authoritative interaction reach");

const militaryPayloadPlan = resourceBreakPlan("fists", "crate_12", 1, 1, 28);
assert.ok(
    militaryPayloadPlan?.feasible,
    "the heavy military payload must remain a deliberate multi-bot break target even when it exceeds the ordinary 16-hit resource limit",
);
assert.ok((militaryPayloadPlan?.estimatedHits ?? 0) > 16);

const closedRoute = shippingContainerRoute(
    "container_01",
    v2.create(100, 100),
    0,
    v2.create(100, 88),
    v2.create(100, 103.25),
);
assert.ok(closedRoute, "loot inside a closed shipping container must get an entrance route");
assert.ok(closedRoute.entranceOutside.y < 95, "closed-container route must approach the open negative-Y mouth");
assert.ok(closedRoute.entranceInside.y > closedRoute.entranceOutside.y);
assert.equal(closedRoute.botInside, false);

const rotatedRoute = shippingContainerRoute(
    "container_01",
    v2.create(100, 100),
    1,
    v2.create(112, 100),
    v2.create(96.75, 100),
);
assert.ok(rotatedRoute, "container entrance geometry must rotate with the building");
assert.ok(rotatedRoute.entranceOutside.x > 105, "orientation 1 must rotate the negative-Y mouth toward positive X");

const throughRoute = shippingContainerRoute(
    "container_04",
    v2.create(100, 100),
    0,
    v2.create(100, 114),
    v2.create(100, 99.95),
);
assert.ok(throughRoute);
assert.ok(throughRoute.entranceOutside.y > 111, "open-through containers should use the nearer end");

assert.equal(
    isSafeContainerEntryBlocker("crate_01", MapObjectDefs.crate_01 as any),
    true,
    "a wooden crate across the mouth should be cleared",
);
assert.equal(
    isSafeContainerEntryBlocker("shack_wall_top", MapObjectDefs.shack_wall_top as any),
    true,
    "a destructible wooden board/wall across an entrance should be cleared",
);
assert.equal(
    isSafeContainerEntryBlocker("container_wall_side", MapObjectDefs.container_wall_side as any),
    false,
    "AI must not mistake the metal container wall for a breakable entrance board",
);
assert.equal(
    isSafeContainerEntryBlocker("barrel_01", MapObjectDefs.barrel_01 as any),
    false,
    "AI must not melee an explosive barrel merely because it blocks a container mouth",
);

console.log("faction airdrop/container smoke test passed");
