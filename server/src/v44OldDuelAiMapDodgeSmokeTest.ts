import assert from "node:assert/strict";
import { MapDefs } from "../../shared/defs/mapDefs.ts";
import { TeamMode } from "../../shared/gameConfig.ts";
import { collider } from "../../shared/utils/collider.ts";
import { collisionHelpers } from "../../shared/utils/collisionHelpers.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { Game } from "./game/game.ts";
import { isDuelMapName } from "../../shared/defs/duelMapNames.ts";
import { chooseDodgeDirection, chooseForbiddenGunLineDodge, type ForbiddenBulletSnapshot } from "./bot/forbiddenCombat.ts";

assert.equal(MapDefs.duel.desc.name, "Duel Arena");
assert.equal(MapDefs.duel.mapGen.map.baseWidth, 176);
assert.equal(MapDefs.duel.mapGen.map.baseHeight, 136);
assert.deepEqual(MapDefs.duel.arena?.playerSpawns, [
    { x: 0.2, y: 0.5 },
    { x: 0.8, y: 0.5 },
]);
assert.equal(MapDefs.duel_ai.desc.name, "AI Combat Lab: Crossfire");
assert.equal(MapDefs.duel_ai.mapGen.map.baseWidth, 188);
assert.equal(MapDefs.duel_ai.mapGen.map.baseHeight, 152);
assert.equal(MapDefs.duel_ai.gameMode.maxPlayers, 2);
assert.equal(isDuelMapName("duel"), true);
assert.equal(isDuelMapName("duel_ai"), true);

const avoidable: ForbiddenBulletSnapshot[] = [{
    id: 1, playerId: 2, pos: { x: 30, y: 50 }, dir: { x: 1, y: 0 },
    speed: 35, damage: 60, remainingDistance: 80, bulletType: "test", layer: 0,
}];
const dodge = chooseDodgeDirection({
    botPos: { x: 50, y: 50 }, botRadius: 1, botLayer: 0, botPlayerId: 1,
    botMoveSpeed: 10, bullets: avoidable, targetPos: { x: 70, y: 50 },
    mapWidth: 100, mapHeight: 100, obstacles: [],
});
assert(dodge, "a bullet with enough remaining flight time must be dodged");
assert(Math.abs(dodge.direction.y) > 0.45);

const unavoidable: ForbiddenBulletSnapshot[] = [{
    id: 2, playerId: 2, pos: { x: 48.7, y: 50 }, dir: { x: 1, y: 0 },
    speed: 90, damage: 90, remainingDistance: 30, bulletType: "test", layer: 0,
}];
const impossible = chooseDodgeDirection({
    botPos: { x: 50, y: 50 }, botRadius: 1, botLayer: 0, botPlayerId: 1,
    botMoveSpeed: 10, bullets: unavoidable, targetPos: { x: 70, y: 50 },
    mapWidth: 100, mapHeight: 100, obstacles: [],
});
assert.equal(impossible, null, "when reaction time is insufficient the AI must keep attacking instead of fake-dodging");

const boxed = chooseDodgeDirection({
    botPos: { x: 50, y: 50 }, botRadius: 1, botLayer: 0, botPlayerId: 1,
    botMoveSpeed: 10, bullets: avoidable, targetPos: { x: 70, y: 50 },
    mapWidth: 100, mapHeight: 100,
    obstacles: [{
        id: 9, type: "test_wall", pos: { x: 50, y: 50 }, layer: 0, height: 2,
        health: 100, maxHealth: 100, healthT: 1, dead: false, collidable: true,
        destructible: false, armorPlated: false, stonePlated: false, reflectBullets: false,
        explosionType: "", explosionRadius: 0,
        collider: { type: 1, min: { x: 45, y: 45 }, max: { x: 55, y: 55 } },
    }],
});
assert.equal(boxed, null, "blocked movement directions are not valid dodge solutions");


const impossiblePreShot = chooseForbiddenGunLineDodge({
    botPos: { x: 50, y: 50 }, enemyPos: { x: 47.5, y: 50 }, enemyDir: { x: 1, y: 0 },
    enemyRange: 80, enemyReady: true, layer: 0, obstacles: [], mapWidth: 100, mapHeight: 100,
    botMoveSpeed: 8.2, enemyProjectileSpeed: 120, reactionSeconds: 0.05,
});
assert.equal(impossiblePreShot, null, "a gun-line dodge with insufficient travel time must be rejected");

const possiblePreShot = chooseForbiddenGunLineDodge({
    botPos: { x: 50, y: 50 }, enemyPos: { x: 10, y: 50 }, enemyDir: { x: 1, y: 0 },
    enemyRange: 80, enemyReady: true, layer: 0, obstacles: [], mapWidth: 100, mapHeight: 100,
    botMoveSpeed: 8.2, enemyProjectileSpeed: 35, reactionSeconds: 0.05,
});
assert(possiblePreShot, "a long-flight gun line must still permit a calculated dodge");

async function runMapInstance(): Promise<void> {
    const game = new Game(
        "v44-ai-map-instance",
        {
            mapName: "duel_ai",
            teamMode: TeamMode.Solo,
            privateGame: true,
            pureAiMatch: true,
            duelPlayerLoadouts: [
                { weapons: ["ak47", "mosin"] },
                { weapons: ["m39", "mp220"] },
            ],
        },
        () => {},
        () => {},
    );
    await game.init();
    assert.equal(game.map.width, 188);
    assert.equal(game.map.height, 152);
    assert.equal(game.map.arenaObstacles.length, 36);
    assert.equal(game.arenaMatch?.totalRounds, 7);

    type ArenaObject = { type: string; pos: { x: number; y: number }; ori?: number; scale?: number };
    const rawObjects = MapDefs.duel_ai.arena!.objects as ArenaObject[];
    const keys = new Set(rawObjects.map((object) => [
        object.type,
        object.pos.x.toFixed(3),
        object.pos.y.toFixed(3),
        object.ori ?? 0,
        object.scale ?? 1,
    ].join("|")));
    for (const object of rawObjects) {
        const horizontal = [object.type, (1 - object.pos.x).toFixed(3), object.pos.y.toFixed(3), object.ori ?? 0, object.scale ?? 1].join("|");
        const vertical = [object.type, object.pos.x.toFixed(3), (1 - object.pos.y).toFixed(3), object.ori ?? 0, object.scale ?? 1].join("|");
        assert(keys.has(horizontal), `AI arena missing horizontal mirror for ${JSON.stringify(object)}`);
        assert(keys.has(vertical), `AI arena missing vertical mirror for ${JSON.stringify(object)}`);
    }

    const leftSpawn = { x: game.map.width * 0.12, y: game.map.height * 0.5 };
    const rightSpawn = { x: game.map.width * 0.88, y: game.map.height * 0.5 };
    const spawnDelta = v2.sub(rightSpawn, leftSpawn);
    const spawnDistance = v2.length(spawnDelta);
    assert(
        collisionHelpers.intersectSegment(
            game.map.obstacles,
            leftSpawn,
            v2.div(spawnDelta, spawnDistance),
            spawnDistance,
            0.5,
            0,
            false,
        ),
        "AI arena must block the frame-one spawn shot",
    );

    const step = 2;
    const columns = Math.floor(game.map.width / step) + 1;
    const rows = Math.floor(game.map.height / step) + 1;
    const collidable = game.map.obstacles.filter((obstacle) => obstacle.collidable && !obstacle.dead);
    const blocked = (x: number, y: number): boolean => {
        const pos = { x: x * step, y: y * step };
        if (pos.x < 2 || pos.y < 2 || pos.x > game.map.width - 2 || pos.y > game.map.height - 2) return true;
        return collidable.some((obstacle) => collider.intersectCircle(obstacle.collider, pos, 1.05));
    };
    const start = [Math.round(leftSpawn.x / step), Math.round(leftSpawn.y / step)] as const;
    const target = [Math.round(rightSpawn.x / step), Math.round(rightSpawn.y / step)] as const;
    const queue: Array<readonly [number, number]> = [start];
    const seen = new Set([`${start[0]},${start[1]}`]);
    const midBands = new Set<string>();
    for (let index = 0; index < queue.length; index++) {
        const [x, y] = queue[index];
        const worldX = x * step;
        const worldY = y * step;
        if (Math.abs(worldX - game.map.width / 2) <= step) {
            midBands.add(worldY < game.map.height * 0.36 ? "north" : worldY > game.map.height * 0.64 ? "south" : "centre");
        }
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
            const nx = x + dx;
            const ny = y + dy;
            const key = `${nx},${ny}`;
            if (nx < 0 || ny < 0 || nx >= columns || ny >= rows || seen.has(key) || blocked(nx, ny)) continue;
            seen.add(key);
            queue.push([nx, ny]);
        }
    }
    assert(seen.has(`${target[0]},${target[1]}`), "AI arena spawns must be path-connected");
    assert.deepEqual([...midBands].sort(), ["centre", "north", "south"]);
    game.stop();
    console.log("V44 old duel / AI map / feasible dodge smoke test passed");
}

void runMapInstance();
