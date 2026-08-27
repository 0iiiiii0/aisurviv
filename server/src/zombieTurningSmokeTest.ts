import assert from "node:assert/strict";
import { TeamMode } from "../../shared/gameConfig.ts";
import { v2, type Vec2 } from "../../shared/utils/v2.ts";
import { Game } from "./game/game.ts";
import type { Player } from "./game/objects/player.ts";

function assertDirection(actual: Vec2, expected: Vec2, label: string): void {
    assert.ok(
        Math.abs(actual.x - expected.x) < 0.001
            && Math.abs(actual.y - expected.y) < 0.001,
        `${label}: expected (${expected.x}, ${expected.y}), got (${actual.x}, ${actual.y})`,
    );
}

const game = new Game(
    `zombie-turning-${Date.now()}`,
    { mapName: "zombie", teamMode: TeamMode.Solo, zombieDifficulty: "hard" },
);

try {
    game.started = true;
    const human = game.playerBarn.addTestPlayer({ name: "TurnTarget" });
    const zombie = game.playerBarn.addTestPlayer({ name: "TurningZombie" });
    zombie.serverBot = true;

    const system = game.zombieMode as unknown as {
        zombies: Player[];
        spawnedInitial: boolean;
        cachedTargets: Map<number, Player>;
        targetCacheUntil: number;
        update(dt: number): void;
    };
    system.spawnedInitial = true;
    system.zombies.push(zombie);

    const center = v2.copy(game.map.center);
    const cases: Array<{ name: string; offset: Vec2; expected: Vec2 }> = [
        { name: "right", offset: v2.create(20, 0), expected: v2.create(1, 0) },
        { name: "left", offset: v2.create(-20, 0), expected: v2.create(-1, 0) },
        { name: "up", offset: v2.create(0, 20), expected: v2.create(0, 1) },
        { name: "down", offset: v2.create(0, -20), expected: v2.create(0, -1) },
    ];

    for (const testCase of cases) {
        zombie.pos = v2.copy(center);
        human.pos = v2.add(center, testCase.offset);
        zombie.layer = human.layer = 0;
        game.grid.updateObject(zombie);
        game.grid.updateObject(human);
        system.cachedTargets.set(zombie.__id, human);
        system.targetCacheUntil = Date.now() + 60_000;

        // Seed stale input in the opposite direction, matching the production
        // failure where Player.update() used to undo the AI facing.
        zombie.dir = v2.mul(testCase.expected, -1);
        zombie.dirNew = v2.copy(zombie.dir);
        game.objectRegister.dirtyPart[zombie.__id] = 0;
        game.objectRegister.dirtyFull[zombie.__id] = 0;
        system.update(0.016);
        assertDirection(zombie.dir, testCase.expected, `${testCase.name} AI dir`);
        assertDirection(zombie.dirNew, testCase.expected, `${testCase.name} AI dirNew`);
        assert.equal(
            game.objectRegister.dirtyPart[zombie.__id],
            1,
            `${testCase.name} facing is marked for network synchronization`,
        );

        game.playerBarn.update(0.016, 0.016, 0.016);
        assertDirection(
            zombie.dir,
            testCase.expected,
            `${testCase.name} survives Player.update`,
        );
    }

    // Self-destruct zombies share the same final facing synchronization even
    // when their rush steering chooses a non-cardinal avoidance direction.
    zombie.zombieSelfDestruct = true;
    zombie.zombieRushing = true;
    zombie.pos = v2.copy(center);
    human.pos = v2.add(center, v2.create(20, 8));
    game.grid.updateObject(zombie);
    game.grid.updateObject(human);
    system.cachedTargets.set(zombie.__id, human);
    system.targetCacheUntil = Date.now() + 60_000;
    system.update(0.016);
    assertDirection(zombie.dirNew, zombie.dir, "self-destruct dir sync");
    game.playerBarn.update(0.016, 0.016, 0.016);
    assertDirection(zombie.dir, zombie.dirNew, "self-destruct survives Player.update");

    console.log("✓ zombie turning: cardinal chase and self-destruct facing survive Player.update");
} finally {
    game.stop();
}
