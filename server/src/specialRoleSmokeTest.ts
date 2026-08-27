import assert from "assert/strict";
import {
    isSelfRevivingFactionMedic,
    planLeaderFlare,
    shouldSoundBugle,
    specialRoleProfile,
} from "./bot/specialRoleStrategy.ts";

const base = {
    position: { x: 300, y: 300 },
    mapWidth: 1024,
    mapHeight: 1024,
    phase: "early" as const,
    health: 100,
    enemyDistance: 100,
    outsideGas: false,
    underAirstrike: false,
    indoors: false,
    nearbyAllies: 0,
    nearbyEnemies: 0,
    hasFlareGun: true,
    flareAmmo: 1,
    nearestAirdropDistance: Infinity,
    nearestStructureDistance: 12,
    safeCenter: { x: 512, y: 512 },
    safeRadius: 420,
    formationAnchor: { x: 300, y: 300 },
    objective: { x: 520, y: 520 },
    homeAnchor: null,
    timestamp: 60_000,
    lastFlareAt: 0,
};

const ordinary = planLeaderFlare({ ...base, timestamp: 180_000 });
assert.equal(
    ordinary.use,
    true,
    "a safe commander flare must outrank waiting for a nearby escort",
);

const opening = planLeaderFlare({ ...base, openingDeployment: true });
assert.equal(opening.use, true, "newly assigned leader should deploy the opening flare without waiting for an escort");
assert.match(opening.reason, /opening deployment/);

const threatened = planLeaderFlare({
    ...base,
    openingDeployment: true,
    enemyDistance: 12,
});
assert.equal(threatened.use, false, "opening flare must still yield to a close enemy");

const distantBattle = planLeaderFlare({
    ...base,
    openingDeployment: true,
    enemyDistance: 22,
    nearbyEnemies: 3,
});
assert.equal(
    distantBattle.use,
    true,
    "distant formation combat must not postpone the commander opening flare forever",
);


const friendlyRearOpening = planLeaderFlare({
    ...base,
    position: { x: 430, y: 512 },
    formationAnchor: { x: 610, y: 512 },
    objective: { x: 760, y: 512 },
    homeAnchor: { x: 150, y: 512 },
    safeCenter: { x: 560, y: 512 },
    openingDeployment: true,
});
assert.equal(friendlyRearOpening.use, true);
assert.ok(
    friendlyRearOpening.stagingPoint.x < 512,
    "opening commander airdrop should remain on the learned friendly half even when the formation is across midline",
);
assert.ok(
    Math.hypot(
        friendlyRearOpening.stagingPoint.x - 560,
        friendlyRearOpening.stagingPoint.y - 512,
    ) <= 408.5,
    "commander flare staging must remain at least 12 units inside the safe circle",
);

const hostileOnlyCircle = planLeaderFlare({
    ...base,
    position: { x: 700, y: 512 },
    formationAnchor: { x: 700, y: 512 },
    objective: { x: 820, y: 512 },
    homeAnchor: { x: 150, y: 512 },
    safeCenter: { x: 850, y: 512 },
    safeRadius: 90,
    openingDeployment: true,
});
assert.equal(
    hostileOnlyCircle.use,
    false,
    "a leader must wait when the safe circle has no usable point in the friendly rear",
);

const collapsedCircle = planLeaderFlare({
    ...base,
    safeRadius: 14,
    openingDeployment: true,
});
assert.equal(
    collapsedCircle.use,
    false,
    "a nearly collapsed circle must not produce a flare point in gas",
);

const indoorOpening = planLeaderFlare({ ...base, openingDeployment: true, indoors: true });
assert.equal(indoorOpening.use, true, "an indoor leader should keep an outdoor deployment plan");
assert.notDeepEqual(
    indoorOpening.stagingPoint,
    base.position,
    "an indoor flare plan must move away from the current indoor position",
);

assert.equal(
    shouldSoundBugle({
        health: 100,
        enemyDistance: 30,
        nearbyAllies: 7,
        nearbyEnemies: 0,
        alliesUnderFire: 0,
        alliesUnderAirstrike: 4,
        stance: "hold",
        phase: "mid",
        hasBugle: true,
        bugleAmmo: 1,
        timestamp: 200_000,
        lastBugleAt: 0,
    }),
    true,
    "bugler should support a nearby formation escaping an airstrike",
);

assert.ok(
    specialRoleProfile("marksman").preferredRangeMultiplier >
        specialRoleProfile("recon").preferredRangeMultiplier,
    "marksman and recon must keep distinct combat ranges",
);
assert.ok(
    specialRoleProfile("medic").rescuePriority >
        specialRoleProfile("lieutenant").rescuePriority,
    "medic must retain a dedicated rescue profile",
);
assert.equal(
    isSelfRevivingFactionMedic({
        factionMode: true,
        downed: true,
        role: "medic",
        actionType: 4,
        reviveActionType: 4,
    }),
    true,
    "50v50 AI must recognize a downed medic who is actively self-reviving",
);
assert.equal(
    isSelfRevivingFactionMedic({
        factionMode: false,
        downed: true,
        role: "medic",
        actionType: 4,
        reviveActionType: 4,
    }),
    false,
);

// A freshly appointed leader must receive a concrete friendly mid-back
// staging point even while it still searches for a flare gun, so it can
// reposition immediately and fire the opening airdrop the moment it is armed.
const unarmedOpening = planLeaderFlare({
    ...base,
    openingDeployment: true,
    hasFlareGun: false,
    flareAmmo: 0,
});
assert.equal(unarmedOpening.use, false, "an unarmed leader cannot fire the flare");
assert.equal(
    unarmedOpening.reason,
    "opening staging while searching for flare",
    "unarmed opening leader should keep a concrete staging plan",
);
assert.ok(
    Math.hypot(
        unarmedOpening.stagingPoint.x - 300,
        unarmedOpening.stagingPoint.y - 300,
    ) > 1.5,
    "unarmed opening staging must be a real mid-back point, not the position fallback",
);
assert.ok(
    unarmedOpening.stagingPoint.x < 512,
    "unarmed opening staging should stay on the friendly half",
);

// A non-opening leader without a flare gun still bails out immediately.
const unarmedRegular = planLeaderFlare({ ...base, hasFlareGun: false, flareAmmo: 0 });
assert.equal(unarmedRegular.use, false);
assert.equal(unarmedRegular.reason, "no flare gun or flare");
assert.equal(unarmedRegular.stagingPoint.x, 300, "regular unarmed leader keeps the position fallback");

// Opening deployment tolerates a closer existing airdrop (26 vs 42).
const nearbyDropOpening = planLeaderFlare({
    ...base,
    openingDeployment: true,
    nearestAirdropDistance: 30,
});
assert.equal(nearbyDropOpening.use, true, "opening drop should tolerate a 30-unit existing airdrop");
const nearbyDropRegular = planLeaderFlare({
    ...base,
    nearestAirdropDistance: 30,
});
assert.equal(nearbyDropRegular.use, false, "regular flare still waits for the airdrop to be farther away");

console.log("special role smoke test passed");
