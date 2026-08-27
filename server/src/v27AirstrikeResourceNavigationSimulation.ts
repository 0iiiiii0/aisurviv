import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
    assessAirstrikeThreat,
    inferEncodedAirstrikeTiming,
    selectAirstrikeEscapeTarget,
    type AirstrikeZoneState,
} from "./bot/airstrikeEvasion.ts";
import {
    navigationRadiusFromDefinition,
    planLocalSteering,
} from "./bot/navigationController.ts";
import {
    airdropObjectivePriority,
    isHighValueAirdropPayload,
    isUsableAirdropShell,
} from "./bot/airdropUtilization.ts";
import { lootBreakableProfile } from "./bot/lootStrategy.ts";
import { predictStrobeAirstrikeWarning } from "./game/objects/projectile.ts";

const warehouseWallRadius = navigationRadiusFromDefinition({
    collision: {
        type: 1,
        min: { x: -0.6, y: -3.2 },
        max: { x: 0.6, y: 3.2 },
    },
});
const brickWallRadius = navigationRadiusFromDefinition({
    collision: {
        type: 1,
        min: { x: -0.5, y: -2 },
        max: { x: 0.5, y: 2 },
    },
});
assert.ok(warehouseWallRadius > 3.2, "warehouse shell must use its full rectangular extent");
assert.ok(brickWallRadius > 2, "brick wall shell must use its full rectangular extent");

const oldWallPlan = planLocalSteering(
    { x: -8, y: 3 },
    { x: 8, y: 3 },
    [{ id: 1, pos: { x: 0, y: 0 }, radius: 2.1 }],
    { clearance: 0.85 },
);
const newWallPlan = planLocalSteering(
    { x: -8, y: 3 },
    { x: 8, y: 3 },
    [{ id: 1, pos: { x: 0, y: 0 }, radius: warehouseWallRadius }],
    { clearance: 0.85 },
);
assert.equal(oldWallPlan.blocked, false, "the previous small-circle approximation should expose the historical gap");
assert.equal(newWallPlan.blocked, true, "the full building-shell radius must close the false gap");

const zone: AirstrikeZoneState = {
    pos: { x: 0, y: 0 },
    rad: 18,
    highDamageRad: 12,
    impactInMs: 650,
    expiresAt: 10_000,
};
const threat = assessAirstrikeThreat({ x: 5, y: 0 }, [zone], 1_000);
assert.ok(threat?.highestPriority, "imminent high-damage-core strike must be absolute priority");
const escape = selectAirstrikeEscapeTarget({
    origin: { x: 5, y: 0 },
    zone: threat!,
    bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
    // Simulate a building shell blocking the mathematically shortest radial path.
    pathClear: (_from, to) => !(to.x > 20 && Math.abs(to.y) < 7),
    isOutsideGas: () => false,
    playerSeed: 7,
});
assert.equal(escape.clear, true, "airstrike escape must choose an alternate clear lane");
assert.ok(Math.hypot(escape.target.x, escape.target.y) > zone.rad + 10);
assert.ok(Math.abs(escape.target.y) >= 7, "escape route must bend around the shell");

const scheduledStrikeBots = Array.from({ length: 40 }, (_, index) => {
    const angle = (index / 40) * Math.PI * 2;
    const radius = 2 + (index % 10);
    const pos = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    const assessed = assessAirstrikeThreat(pos, [zone], 1_000);
    assert.ok(assessed, `bot ${index + 1} must receive the single-strike warning`);
    assert.equal(assessed!.highestPriority, true, `bot ${index + 1} in core must pre-empt all other logic`);
    const target = selectAirstrikeEscapeTarget({
        origin: pos,
        zone: assessed!,
        bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
        pathClear: () => true,
        isOutsideGas: () => false,
        playerSeed: index + 1,
    }).target;
    return {
        id: index + 1,
        startDistance: radius,
        targetDistance: Math.hypot(target.x, target.y),
    };
});
assert.equal(
    scheduledStrikeBots.filter((bot) => bot.targetDistance > zone.rad + 10).length,
    40,
    "all bots must receive a destination outside the complete strike footprint",
);

const thrownAt = 50_000;
const strobe = predictStrobeAirstrikeWarning(
    {
        pos: { x: 20, y: 30 },
        vel: { x: 28, y: 2 },
        posZ: 0.5,
        velZ: 5,
        createdAtMs: thrownAt,
    },
    false,
    176,
    136,
    thrownAt + 350,
);
assert.ok(strobe);
assert.ok(strobe!.impactIn > 1.9 && strobe!.impactIn < 2.3);
assert.ok(strobe!.highDamageRad < strobe!.rad);
const decodedStrobeTiming = inferEncodedAirstrikeTiming(strobe!.rad, strobe!.duration);
assert.ok(Math.abs(decodedStrobeTiming.impactInMs - strobe!.impactIn * 1000) < 2);
assert.ok(Math.abs(decodedStrobeTiming.highDamageRad - strobe!.highDamageRad) < 0.1);
const decodedPlaneTiming = inferEncodedAirstrikeTiming(18, 4.0);
assert.ok(Math.abs(decodedPlaneTiming.impactInMs - 1200) < 2);

assert.equal(
    isUsableAirdropShell({
        type: "airdrop_crate_01",
        dead: false,
        button: { canUse: true, onOff: false },
    }),
    true,
);
assert.equal(
    isUsableAirdropShell({
        type: "airdrop_crate_02",
        dead: false,
        button: { canUse: true, onOff: true },
    }),
    false,
);
assert.equal(isHighValueAirdropPayload({ type: "crate_12", dead: false }), true);
assert.equal(isHighValueAirdropPayload({ type: "crate_14", dead: false }), false);
assert.ok(
    airdropObjectivePriority("payload", 25, {
        unarmed: true,
        friendlySide: true,
        expectedLootValue: 240,
        estimatedBreakCost: 12,
    }) > airdropObjectivePriority("shell", 25),
    "opened high-value payload must outrank an ordinary shell when safe",
);

const throwableCrate = lootBreakableProfile("crate_14", 1);
const ammoCrate = lootBreakableProfile("crate_04", 1);
const payload = lootBreakableProfile("crate_12", 1);
assert.ok(throwableCrate && throwableCrate.priorityBias >= 30);
assert.ok(ammoCrate?.armorPlated, "plated ammo crate must be classified, not attacked by incapable weapons");
assert.ok(payload && payload.expectedLootValue >= 200);
assert.equal(lootBreakableProfile("oven_01", 1), null, "explosive no-loot furniture is not a resource");
assert.equal(lootBreakableProfile("barrel_01", 1), null, "explosive barrel is tactical cover, not loot");
assert.equal(lootBreakableProfile("refrigerator_01", 1), null, "non-destructible refrigerator is not a resource");

const report = {
    version: 27,
    simulation: "airstrike-resource-navigation deterministic validation",
    buildingShell: {
        warehouseWallRadius,
        brickWallRadius,
        historicalFalseGapDetected: !oldWallPlan.blocked,
        correctedShellBlocked: newWallPlan.blocked,
    },
    airstrike: {
        criticalThreat: {
            highestPriority: threat!.highestPriority,
            impactInMs: threat!.impactInMs,
            insideHighDamage: threat!.insideHighDamage,
        },
        alternateRouteClear: escape.clear,
        alternateTarget: escape.target,
        singleStrikeBotsWarned: scheduledStrikeBots.length,
        singleStrikeBotsRoutedOutside: scheduledStrikeBots.filter(
            (bot) => bot.targetDistance > zone.rad + 10,
        ).length,
        strobePrediction: strobe,
    },
    resources: {
        throwableCrate,
        platedAmmoCrate: ammoCrate,
        airdropPayload: payload,
        falseResourceTypesExcluded: ["oven_01", "barrel_01", "refrigerator_01"],
    },
    airdrop: {
        standardShellsSupported: ["airdrop_crate_01", "airdrop_crate_02", "airdrop_crate_03", "airdrop_crate_04"],
        payloadsSupported: ["crate_10", "crate_11", "crate_12", "crate_13"],
    },
    result: "PASS",
};

const out = join(process.cwd(), "V27_AIRSTRIKE_RESOURCE_NAV_SIMULATION.json");
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`simulation written to ${out}`);
