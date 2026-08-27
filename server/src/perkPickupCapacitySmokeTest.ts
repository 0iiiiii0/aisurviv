import assert from "node:assert/strict";
import { perkPickupPlan } from "./game/objects/player.ts";

const droppable = (type: string, isBroughtIn = false) => ({
    type,
    droppable: true,
    isBroughtIn,
});
const permanent = (type: string) => ({ type, droppable: false });

// 搜打撤/绝密：局内槽位由带出槽位锁定，带入能力永远不被自动替换。
{
    const perks = [
        ...Array.from({ length: 4 }, (_, index) => droppable(`brought_${index}`, true)),
        ...Array.from({ length: 2 }, (_, index) => droppable(`picked_${index}`)),
    ];
    const plan = perkPickupPlan(perks, true, 7);
    assert.equal(plan.limit, 7);
    assert.equal(plan.replaceType, undefined, "the final empty extraction slot is append-only");
}

// 七槽已满时只能替换局内拾取能力；若只有带入能力，则正确拒绝。
assert.equal(
    perkPickupPlan(
        [
            ...Array.from({ length: 4 }, (_, index) => droppable(`brought_${index}`, true)),
            ...Array.from({ length: 3 }, (_, index) => droppable(`picked_${index}`)),
        ],
        true,
        7,
    ).replaceType,
    "picked_0",
);
assert.equal(
    perkPickupPlan(
        Array.from({ length: 7 }, (_, index) => permanent(`perk_${index}`)),
        true,
        7,
    )
        .replaceType,
        undefined,
);

assert.equal(
    perkPickupPlan([droppable("brought", true)], true, 1).replaceType,
    undefined,
    "a single brought-in perk cannot be replaced when the locked cap is 1",
);

// 其他模式保持原版行为：4 槽限制，已有可掉落能力时继续使用替换机制。
const normal = perkPickupPlan([droppable("old_perk")], false);
assert.equal(normal.limit, 4);
assert.equal(normal.replaceType, "old_perk");

console.log(
    "Perk pickup capacity smoke test passed: extraction slots follow carry-out caps and preserve brought-in perks; normal modes keep four-slot behavior.",
);
