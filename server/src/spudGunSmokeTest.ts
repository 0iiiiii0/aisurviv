import assert from "assert";

import { GameObjectDefs } from "../../shared/defs/gameObjectDefs.ts";
import { resolveProjectileGunBallistics } from "./bot/weaponBallistics.ts";
import { advanceSpudEffect, applySpudHit, EMPTY_SPUD_EFFECT } from "./game/spudEffect.ts";

const profile = resolveProjectileGunBallistics("potato_smg");
assert.ok(profile, "Spud Gun must resolve its projectile/explosion profile");
assert.equal(profile.damage, 13);
assert.equal(profile.speed, 85);
assert.equal(profile.range, 32);
assert.equal(profile.onHit, "potato_smgshot");

const gun = GameObjectDefs.potato_smg as any;
assert.equal(gun.moveSpread, 7);
assert.equal(gun.speed.attack, -6);
assert.equal(gun.ammoInfinite, true);

const firstHit = applySpudHit(
    { ...EMPTY_SPUD_EFFECT },
    {
        scalePerHit: 0.04,
        maxScaleBonus: 0.4,
        decayDelay: 1.25,
        speedPenaltyPerScale: 5,
    },
    false,
);
assert.equal(firstHit.scaleBonus, 0.04);
const capped = Array.from({ length: 20 }).reduce<typeof firstHit>(
    (state) =>
        applySpudHit(
            state,
            {
                scalePerHit: 0.04,
                maxScaleBonus: 0.4,
                decayDelay: 1.25,
                speedPenaltyPerScale: 5,
            },
            false,
        ),
    firstHit,
);
assert.equal(capped.scaleBonus, 0.4);
assert.equal(
    applySpudHit(firstHit, {
        scalePerHit: 0.04,
        maxScaleBonus: 0.4,
        decayDelay: 1.25,
        speedPenaltyPerScale: 5,
    }, true).scaleBonus,
    firstHit.scaleBonus,
    "Small Arms must block additional enlargement",
);
const delayed = advanceSpudEffect(firstHit, 1, 0.12);
assert.equal(delayed.scaleBonus, firstHit.scaleBonus);
const decayed = advanceSpudEffect({ ...delayed, decayDelay: 0 }, 1, 0.12);
assert.equal(decayed.scaleBonus, 0);

console.log("spud gun smoke test passed");
