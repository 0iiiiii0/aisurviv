import assert from "assert";
import { GameObjectDefs } from "../../shared/defs/gameObjectDefs.ts";
import { MapDefs } from "../../shared/defs/mapDefs.ts";
import { MapObjectDefs } from "../../shared/defs/mapObjectDefs.ts";
import { collider } from "../../shared/utils/collider.ts";
import {
    LootBarn,
    lootMovementPlan,
    releaseExpiredLootOwner,
    sweepLootCircleAgainstCollider,
} from "./game/objects/loot.ts";

for (const [objectType, rawDef] of Object.entries(MapObjectDefs as Record<string, any>)) {
    const def = rawDef as any;
    if (def.type !== "obstacle" || !Array.isArray(def.loot)) continue;
    for (const entry of def.loot) {
        if ("tier" in entry) continue;
        const itemType = String(entry.type ?? "");
        const itemDef = GameObjectDefs[itemType];
        assert.ok(
            itemDef && "lootImg" in itemDef,
            `Obstacle ${objectType} references invalid loot type ${itemType || "<empty>"}`,
        );
    }
}

for (const [mapName, mapDef] of Object.entries(MapDefs as Record<string, any>)) {
    const lootTable = mapDef.lootTable ?? {};
    for (const [tier, entries] of Object.entries(lootTable) as Array<[string, any[]]>) {
        for (const entry of entries) {
            const itemName = String(entry.name ?? "");
            // Empty weighted entries intentionally represent a no-drop result.
            if (!itemName) continue;
            if (itemName.startsWith("tier_")) {
                assert.ok(
                    Array.isArray(lootTable[itemName]),
                    `${mapName}:${tier} references missing loot tier ${itemName}`,
                );
                continue;
            }
            const itemDef = GameObjectDefs[itemName];
            assert.ok(
                itemDef && "lootImg" in itemDef,
                `${mapName}:${tier} references invalid loot type ${itemName}`,
            );
        }
    }
}

let registered = 0;
let warnings = 0;
const fakeGame = {
    logger: { warn: () => warnings++ },
    objectRegister: { register: () => registered++ },
} as any;
const barn = new LootBarn(fakeGame);
barn.addLoot("outfitDarkGhillie", { x: 0, y: 0 }, 0, 1);
barn.addLoot(undefined as unknown as string, { x: 0, y: 0 }, 0, 1);
assert.equal(registered, 0, "invalid loot must never reach object registration");
assert.equal(warnings, 2, "each invalid loot type should be logged once instead of crashing");

const hitchPlan = lootMovementPlan(18, 0.8, 0.45);
assert.equal(hitchPlan.movementDt, 0.1, "loot movement dt must be clamped during a server hitch");
assert.ok(hitchPlan.steps >= 12, "fast loot must use collision substeps instead of one tunnelling leap");
assert.ok(
    (18 * hitchPlan.movementDt) / hitchPlan.steps <= hitchPlan.maxStepDistance + 1e-9,
    "each planned movement segment must stay below the collision-safe distance",
);

const thinWall = collider.createAabb({ x: 4.96, y: -2 }, { x: 5.04, y: 2 });
const sweepHit = sweepLootCircleAgainstCollider(
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    0.45,
    thinWall,
);
assert.ok(sweepHit, "continuous sweep must detect a thin wall crossed in one lagged step");
assert.ok(
    Math.abs(sweepHit!.point.x - 4.51) < 0.03,
    "loot center must stop at the wall expanded by its radius",
);
assert.deepEqual(sweepHit!.normal, { x: -1, y: 0 });

const boundaryMovingAway = sweepLootCircleAgainstCollider(
    { x: 4.51, y: 0 },
    { x: 3.5, y: 0 },
    0.45,
    thinWall,
);
assert.equal(
    boundaryMovingAway,
    null,
    "a loot item already touching a wall must remain free to move away",
);

const reservedAmmo = { ownerId: 81, ownerExpiresAt: 20_000 };
assert.equal(releaseExpiredLootOwner(reservedAmmo, 19_999), false);
assert.equal(reservedAmmo.ownerId, 81, "reserved ammo must remain unavailable to other AI");
assert.equal(releaseExpiredLootOwner(reservedAmmo, 20_000), true);
assert.deepEqual(
    reservedAmmo,
    { ownerId: 0, ownerExpiresAt: 0 },
    "unclaimed ammo must return to public loot after the reservation window",
);

console.log("Loot definition/runtime and anti-tunnelling safety smoke test passed");
