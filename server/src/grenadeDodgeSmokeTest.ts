import assert from "node:assert/strict";
import {
    chooseGrenadeEscape,
    type GrenadeThreatProjectile,
} from "./bot/grenadeDodge.ts";

const mapWidth = 1024;
const mapHeight = 1024;

function frag(pos: { x: number; y: number }, dir: { x: number; y: number }, id = 1): GrenadeThreatProjectile {
    return { id, type: "frag", layer: 0, pos, dir };
}

const fresh = () => 0;

// 1) A frag sitting a few units away forces an escape in the opposite direction.
{
    const botPos = { x: 100, y: 100 };
    const direction = chooseGrenadeEscape({
        botPos,
        botLayer: 0,
        projectiles: [frag({ x: 95, y: 100 }, { x: 0, y: 1 })],
        mapWidth,
        mapHeight,
        ageSeconds: fresh,
    });
    assert.ok(direction, "a nearby frag must produce an escape vector");
    assert.ok(direction.x > 0.5, "the bot must run away from the frag");
    assert.ok(direction.y < -0.5, "the bot must run away from the predicted landing point");
}

// 2) A frag far outside the danger radius is ignored.
{
    const direction = chooseGrenadeEscape({
        botPos: { x: 100, y: 100 },
        botLayer: 0,
        projectiles: [frag({ x: 70, y: 100 }, { x: 0, y: 1 })],
        mapWidth,
        mapHeight,
        ageSeconds: fresh,
    });
    assert.equal(direction, null, "a frag 30 units away must not panic the bot");
}

// 3) Projectiles on another layer never threaten the bot.
{
    const direction = chooseGrenadeEscape({
        botPos: { x: 100, y: 100 },
        botLayer: 0,
        projectiles: [{ id: 1, type: "frag", layer: 1, pos: { x: 95, y: 100 }, dir: { x: 0, y: 1 } }],
        mapWidth,
        mapHeight,
        ageSeconds: fresh,
    });
    assert.equal(direction, null, "a frag on another layer must be ignored");
}

// 4) A frag first seen more than 4.6 s ago is stale and no longer dangerous.
{
    const stale = (id: number) => (id === 1 ? 5 : 0);
    const direction = chooseGrenadeEscape({
        botPos: { x: 100, y: 100 },
        botLayer: 0,
        projectiles: [frag({ x: 95, y: 100 }, { x: 0, y: 1 })],
        mapWidth,
        mapHeight,
        ageSeconds: stale,
    });
    assert.equal(direction, null, "a stale pool entry must never re-arm the panic");
}

// 5) A projectile heading toward the bot triggers even from further away.
{
    const direction = chooseGrenadeEscape({
        botPos: { x: 100, y: 100 },
        botLayer: 0,
        projectiles: [frag({ x: 82, y: 100 }, { x: 1, y: 0 }, 5)],
        mapWidth,
        mapHeight,
        ageSeconds: fresh,
    });
    assert.ok(direction, "an incoming frag must trigger the dodge");
    assert.ok(direction.x > 0.99, "the bot must run away from the predicted landing point");
}

// 6) MIRV uses a larger danger radius than a frag.
{
    const direction = chooseGrenadeEscape({
        botPos: { x: 100, y: 100 },
        botLayer: 0,
        projectiles: [{ id: 2, type: "mirv", layer: 0, pos: { x: 84, y: 100 }, dir: { x: 0, y: 1 } }],
        mapWidth,
        mapHeight,
        ageSeconds: fresh,
    });
    assert.ok(direction, "a mirv at 16 units must trigger the dodge (bigger radius)");
}

// 7) Two grenades on opposite sides produce a weighted compromise vector.
{
    const direction = chooseGrenadeEscape({
        botPos: { x: 100, y: 100 },
        botLayer: 0,
        projectiles: [
            frag({ x: 95, y: 100 }, { x: 0, y: 1 }, 10),
            frag({ x: 105, y: 100 }, { x: 0, y: 1 }, 11),
        ],
        mapWidth,
        mapHeight,
        ageSeconds: fresh,
    });
    assert.ok(direction, "opposite grenades must still produce an escape");
    assert.ok(Math.abs(direction.y) > 0.95, "the compromise must point along the free axis");
}

// 8) A dodge direction pushing into the map border is redirected inward.
{
    const direction = chooseGrenadeEscape({
        botPos: { x: 2, y: 100 },
        botLayer: 0,
        projectiles: [frag({ x: 8, y: 100 }, { x: 1, y: 0 }, 20)],
        mapWidth,
        mapHeight,
        ageSeconds: fresh,
    });
    assert.ok(direction, "the border dodge must still produce a direction");
    assert.ok(direction.x > 0, "the bot must not be pushed out of the map");
}

// 9) Smoke, strobes and gun bullets never count as grenade threats.
{
    const direction = chooseGrenadeEscape({
        botPos: { x: 100, y: 100 },
        botLayer: 0,
        projectiles: [
            { id: 30, type: "smoke", layer: 0, pos: { x: 95, y: 100 }, dir: { x: 0, y: 1 } },
            { id: 31, type: "strobe", layer: 0, pos: { x: 96, y: 100 }, dir: { x: 0, y: 1 } },
            { id: 32, type: "762mm", layer: 0, pos: { x: 94, y: 100 }, dir: { x: 0, y: 1 } },
        ],
        mapWidth,
        mapHeight,
        ageSeconds: fresh,
    });
    assert.equal(direction, null, "smoke/strobe/bullets must not trigger grenade panic");
}

console.log("grenade-dodge smoke test passed");
