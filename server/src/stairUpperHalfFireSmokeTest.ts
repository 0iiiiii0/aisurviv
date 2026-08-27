import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { v2 } from "../../shared/utils/v2.ts";
import {
    evaluateCrossFloorShot,
    type StairFireRegion,
} from "./bot/crossFloorFireSafety.ts";
import { Game } from "./game/game.ts";

const game = new Game("stair-upper-fire", {
    mapName: "main",
    teamMode: TeamMode.Duo,
});

try {
    const structure = game.map.structures.find((candidate) =>
        candidate.stairs.some((stair) => !stair.lootOnly)
    );
    const stairIndex = structure?.stairs.findIndex((stair) => !stair.lootOnly) ?? -1;
    assert.ok(structure && stairIndex >= 0, "the generated map must contain a usable stair");
    const stair = structure.stairs[stairIndex];
    const center = { ...stair.center };
    const down = v2.normalizeSafe(stair.downDir);
    const upperPos = {
        x: (stair.upAabb.min.x + stair.upAabb.max.x) * 0.5,
        y: (stair.upAabb.min.y + stair.upAabb.max.y) * 0.5,
    };
    const halfAlong = Math.abs(down.x) * (stair.collision.max.x - stair.collision.min.x) * 0.5
        + Math.abs(down.y) * (stair.collision.max.y - stair.collision.min.y) * 0.5;
    const lowerPos = {
        x: center.x + down.x * (halfAlong + 4),
        y: center.y + down.y * (halfAlong + 4),
    };

    // Keep the real Structure/stair but remove incidental doors or props from
    // this short ballistic lane, so the test isolates floor-layer behaviour.
    for (const obstacle of game.map.obstacles) {
        if (v2.distance(obstacle.pos, center) <= halfAlong + 8) obstacle.dead = true;
    }

    const shooter = game.playerBarn.addTestPlayer({
        name: "UpperStairAI",
        pos: upperPos,
    });
    shooter.serverBot = true;
    const target = game.playerBarn.addTestPlayer({
        name: "LowerStairHuman",
        pos: lowerPos,
    });
    assert.notEqual(shooter.groupId, target.groupId, "shooter and target must be enemies");
    target.layer = 1;
    target.aimLayer = 1;
    target.health = 500;
    target.spawnProtectionUntil = 0;

    v2.set(shooter.pos, upperPos);
    v2.set(shooter.posOld, upperPos);
    v2.set(shooter.dir, down);
    v2.set(shooter.dirNew, down);
    shooter.layer = 0;
    shooter.aimLayer = 0;
    game.grid.updateObject(shooter);
    game.grid.updateObject(target);

    // Run the real Player stair calculation. The upper half becomes layer 2;
    // aiming along downDir must select bullet/aim layer 3.
    shooter.update(0.02);
    assert.equal(shooter.layer, 2, "AI on the stair upper half must enter layer 2");
    assert.equal(shooter.aimLayer, 3, "aiming downward must select the bunker stair layer");

    const fireRegion: StairFireRegion = {
        structureId: structure.__id,
        stairIndex,
        min: { ...stair.collision.min },
        max: { ...stair.collision.max },
        downDir: { ...down },
    };
    const gate = evaluateCrossFloorShot({
        shooterPos: { ...shooter.pos },
        shooterLayer: shooter.layer,
        targetPos: { ...target.pos },
        targetLayer: target.layer,
        stairs: [fireRegion],
        bodyMargin: GameConfig.player.radius + 0.35,
        endpointReach: 13,
    });
    assert.equal(gate.allowed, true, `SmartBot final fire gate rejected the shot: ${gate.reason}`);

    shooter.weaponManager.setWeapon(GameConfig.WeaponSlot.Primary, "m4a1", 30);
    shooter.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Primary, true);
    shooter.weaponManager.fireWeapon(false, true);
    const bullet = game.bulletBarn.bullets.at(-1);
    assert.ok(bullet, "the approved stair shot must create a bullet");
    assert.equal(bullet.layer, 3, "the server bullet must use the bunker-facing stair layer");

    const healthBefore = target.health;
    for (let index = 0; index < 20 && target.health === healthBefore; index++) {
        game.bulletBarn.update(0.02);
    }
    assert.ok(
        target.health < healthBefore,
        `layer-3 stair bullet must damage the layer-1 player (${target.health}/${healthBefore})`,
    );

    console.log(
        "Upper-stair AI fire smoke test passed: "
            + `structure=${structure.type}:${stairIndex}, shooterLayer=${shooter.layer}, `
            + `aimLayer=${shooter.aimLayer}, bulletLayer=${bullet.layer}, `
            + `damage=${(healthBefore - target.health).toFixed(1)}.`,
    );
} finally {
    game.stop();
}
process.exit(0);
