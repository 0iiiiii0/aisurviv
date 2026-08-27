import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { MapObjectDefs } from "../../shared/defs/mapObjectDefs.ts";
import {
    airdropGunPriorityBias,
    airdropSearchRadius,
    isUsableAirdropShell,
} from "./bot/airdropUtilization.ts";
import {
    chooseHardCoverFlank,
    closeOutOfRangeDirection,
    shouldForceVisibleTrigger,
    visibleTriggerDeadlineMs,
} from "./bot/engagementRecovery.ts";
import {
    blocksLocalMovement,
    isAuthoritativelyDestructibleCover,
    isHardIndestructibleCover,
} from "./bot/obstaclePolicy.ts";
import { planStuckRecovery } from "./bot/navigationController.ts";
import {
    lootSourceAssociationRadius,
    lootSourceMemoryMs,
} from "./bot/resourceCombatPolicy.ts";
import { chooseVisibleThreatInterrupt } from "./bot/spectatorSupervisor.ts";

const windowDef = MapObjectDefs.house_window_01 as any;
assert.equal(blocksLocalMovement({ type: "house_window_01", definition: windowDef }), true);
assert.equal(
    isAuthoritativelyDestructibleCover({
        type: "house_window_01",
        definition: windowDef,
        allowWindow: false,
    }),
    false,
    "window must not be selected as an entrance-clearing objective",
);

for (const type of ["container_wall_top", "brick_wall_ext_3", "warehouse_wall_side"]) {
    const definition = (MapObjectDefs as Record<string, any>)[type];
    assert.equal(
        isHardIndestructibleCover({ type, definition }),
        true,
        `${type} must be recognized as hard cover`,
    );
    assert.equal(
        isAuthoritativelyDestructibleCover({ type, definition }),
        false,
        `${type} must never be targeted for destruction`,
    );
}
assert.equal(
    isAuthoritativelyDestructibleCover({
        type: "house_wall_int_4",
        definition: (MapObjectDefs as Record<string, any>).house_wall_int_4,
    }),
    true,
);

const normalDeadline = visibleTriggerDeadlineMs("normal", 250);
assert.equal(
    shouldForceVisibleTrigger({
        difficulty: "normal",
        reactionMs: 250,
        visibleForMs: normalDeadline - 1,
        legalLine: true,
        inRange: true,
        ammoReady: true,
    }),
    false,
);
assert.equal(
    shouldForceVisibleTrigger({
        difficulty: "normal",
        reactionMs: 250,
        visibleForMs: normalDeadline,
        legalLine: true,
        inRange: true,
        ammoReady: true,
    }),
    true,
    "a legal visible target must eventually receive a deterministic trigger",
);

const longRangeVoluntaryInterrupt = chooseVisibleThreatInterrupt({
    enemyVisible: true,
    enemyDistance: 48,
    hasUsableGun: true,
    usableWeaponRange: 100,
    reactionReady: true,
    millisecondsSinceDamage: 10_000,
    currentState: "loot",
    pendingThrowableRelease: false,
    survivalEmergency: false,
});
assert.equal(
    longRangeVoluntaryInterrupt.interrupt,
    true,
    "a visible enemy inside the equipped rifle's practical range must interrupt looting",
);

const close = closeOutOfRangeDirection({
    baseDirection: { x: 0, y: 1 },
    botPos: { x: 0, y: 0 },
    enemyPos: { x: 32, y: 0 },
    distance: 32,
    weaponRange: 27,
});
assert.ok(close.x > 0.75, "short-range weapon must strongly close the range");

const flank = chooseHardCoverFlank({
    botPos: { x: 0, y: 0 },
    enemyPos: { x: 20, y: 0 },
    blockerPos: { x: 9, y: 0 },
    blockerRadius: 2.4,
    preferredSign: 1,
    bounds: { minX: -30, minY: -30, maxX: 30, maxY: 30 },
    pathClear: (_from, to) => Math.abs(to.y) > 2.6,
    shotClear: (from) => Math.abs(from.y) > 3,
});
assert.ok(flank, "hard cover must produce a reachable flank shoulder");
assert.ok(Math.abs(flank!.point.y) > 3);

assert.equal(
    isUsableAirdropShell({ type: "airdrop_crate_01", button: { onOff: false } }),
    true,
    "normal-mode shell snapshots may omit canUse until the bot approaches",
);
assert.equal(
    isUsableAirdropShell({ type: "airdrop_crate_01", button: { canUse: false, onOff: false } }),
    false,
);
assert.equal(
    isUsableAirdropShell({ type: "airdrop_crate_01", button: { canUse: true, onOff: true } }),
    false,
);

const mainShellRange = airdropSearchRadius({
    kind: "shell",
    unarmed: false,
    mapProfileId: "main",
    interest: 0.55,
});
const eventShellRange = airdropSearchRadius({
    kind: "shell",
    unarmed: false,
    mapProfileId: "potato",
    interest: 0.55,
});
assert.ok(mainShellRange >= 150, "normal mode must search broadly for standard airdrops");
assert.ok(mainShellRange > eventShellRange);
assert.ok(
    airdropSearchRadius({ kind: "gun", unarmed: true, mapProfileId: "main", interest: 0.55 }) > 130,
);
assert.ok(airdropGunPriorityBias(140) >= 15);
assert.equal(lootSourceMemoryMs("airdrop"), 45_000);
assert.equal(lootSourceAssociationRadius("military-airdrop"), 32);

const desired = { x: 1, y: 0 };
const blockers = [{ id: 1, pos: { x: 2.2, y: 0 }, radius: 2.1 }];
const firstRecovery = planStuckRecovery(
    { x: 0, y: 0 },
    blockers,
    { desiredDirection: desired, attempt: 5, previousDirection: { x: 0, y: 1 } },
);
const prolongedRecovery = planStuckRecovery(
    { x: 0, y: 0 },
    blockers,
    { desiredDirection: desired, attempt: 8, previousDirection: firstRecovery.direction },
);
const repeatDot =
    firstRecovery.direction.x * prolongedRecovery.direction.x +
    firstRecovery.direction.y * prolongedRecovery.direction.y;
assert.ok(repeatDot < 0.92, "long-lived stalls must rotate away from the previous failed direction");

const result = {
    windowBlocked: true,
    hardCoverTypes: 3,
    forcedTriggerDeadlineMs: normalDeadline,
    longRangeVoluntaryInterrupt: longRangeVoluntaryInterrupt.interrupt,
    closeDirection: close,
    flank,
    mainShellSearchRange: mainShellRange,
    eventShellSearchRange: eventShellRange,
    airdropMemoryMs: lootSourceMemoryMs("airdrop"),
    airdropAssociationRadius: lootSourceAssociationRadius("airdrop"),
    prolongedRecoveryDirectionChanged: repeatDot < 0.92,
};

const outputPath = join(process.cwd(), "v32-combat-navigation-airdrop-simulation.json");
writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
console.log("v32 combat, navigation and airdrop simulation passed");
