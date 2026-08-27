import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { MapDefs } from "../../shared/defs/mapDefs.ts";
import { JoinMsg } from "../../shared/net/joinMsg.ts";
import { collider } from "../../shared/utils/collider.ts";
import { collisionHelpers } from "../../shared/utils/collisionHelpers.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { Config } from "./config.ts";
import { getBotAutoFillPolicy } from "./botAutoFill.ts";
import {
    createServerGameConfig,
    getConfiguredRoomPlayerLimit,
} from "./game/gameManager.ts";
import { Game } from "./game/game.ts";

const siteInfoSource = fs.readFileSync(
    path.join(__dirname, "../../client/src/siteInfo.ts"),
    "utf8",
);

assert.equal(
    typeof Config.modes.find((mode) => mode.mapName === "duel")?.enabled,
    "boolean",
    "random/public 1v1 matchmaking must have its own configurable switch",
);
assert.equal(
    typeof Config.duel.roomModeEnabled,
    "boolean",
    "private 1v1 rooms must have an independent configurable switch",
);
assert.equal(
    getBotAutoFillPolicy("duel", TeamMode.Solo),
    undefined,
    "1v1 must not expose an AI join-wait policy",
);

const originalLimits = { ...Config.roomPlayerLimits };
Config.roomPlayerLimits = { solo: 18, duo: 24, squad: 32, faction: 100 };
assert.equal(getConfiguredRoomPlayerLimit(TeamMode.Solo), 18);
assert.equal(getConfiguredRoomPlayerLimit(TeamMode.Duo), 24);
assert.equal(getConfiguredRoomPlayerLimit(TeamMode.Squad), 32);
assert.equal(createServerGameConfig({ mapName: "main", teamMode: TeamMode.Solo }).maxPlayersOverride, 18);
assert.equal(createServerGameConfig({ mapName: "main", teamMode: TeamMode.Duo }).maxPlayersOverride, 24);
assert.equal(createServerGameConfig({ mapName: "main", teamMode: TeamMode.Squad }).maxPlayersOverride, 32);
assert.equal(createServerGameConfig({ mapName: "potato", teamMode: TeamMode.Duo }).maxPlayersOverride, 24);
assert.equal(createServerGameConfig({ mapName: "desert", teamMode: TeamMode.Squad }).maxPlayersOverride, 32);
assert.equal(createServerGameConfig({ mapName: "duel", teamMode: TeamMode.Solo }).maxPlayersOverride, undefined);
assert.equal(createServerGameConfig({ mapName: "faction", teamMode: TeamMode.Squad }).maxPlayersOverride, undefined);
Config.roomPlayerLimits = originalLimits;

const duel = MapDefs.duel;
assert.equal(duel.mapGen.map.baseWidth, 176);
assert.equal(duel.mapGen.map.baseHeight, 136);
assert.equal(duel.arena?.playerSpawns.length, 2);
assert.ok(Math.abs(duel.arena!.playerSpawns[0].x + duel.arena!.playerSpawns[1].x - 1) < 1e-9);
assert.equal(duel.arena!.playerSpawns[0].y, duel.arena!.playerSpawns[1].y);
type ArenaObject = { type: string; pos: { x: number; y: number }; ori?: number; scale?: number };
const arenaObjects = duel.arena!.objects as ArenaObject[];
const objectKeys = new Set(
    arenaObjects.map((object: ArenaObject) =>
        [object.type, object.pos.x.toFixed(3), object.pos.y.toFixed(3), object.ori ?? 0, object.scale ?? 1].join("|"),
    ),
);
for (const object of arenaObjects) {
    const horizontal = [
        object.type,
        (1 - object.pos.x).toFixed(3),
        object.pos.y.toFixed(3),
        object.ori ?? 0,
        object.scale ?? 1,
    ].join("|");
    const vertical = [
        object.type,
        object.pos.x.toFixed(3),
        (1 - object.pos.y).toFixed(3),
        object.ori ?? 0,
        object.scale ?? 1,
    ].join("|");
    assert.ok(objectKeys.has(horizontal), `missing horizontal mirror for ${JSON.stringify(object)}`);
    assert.ok(objectKeys.has(vertical), `missing vertical mirror for ${JSON.stringify(object)}`);
}

async function run(): Promise<void> {
const game = new Game(
    "v41-per-player-loadouts",
    {
        mapName: "duel",
        teamMode: TeamMode.Solo,
        privateGame: true,
        duelPlayerLoadouts: [
            { weapons: ["ak47", "mosin"] },
            { weapons: ["m39", "mp220"] },
        ],
    },
    () => {},
    () => {},
);
await game.init();

// The two spawns must not have a frame-zero direct shot. The first obstacle on
// that ray is the symmetric spawn-gate sandbag, not an invisible map border.
const leftSpawn = { x: game.map.width * 0.2, y: game.map.height * 0.5 };
const rightSpawn = { x: game.map.width * 0.8, y: game.map.height * 0.5 };
const spawnDelta = v2.sub(rightSpawn, leftSpawn);
const spawnDistance = v2.length(spawnDelta);
const firstBlock = collisionHelpers.intersectSegment(
    game.map.obstacles,
    leftSpawn,
    v2.div(spawnDelta, spawnDistance),
    spawnDistance,
    0.5,
    0,
    false,
);
assert(firstBlock, "spawn-to-spawn line must be blocked");
assert(game.objectRegister.getById(firstBlock.id), "the opening blocker must be a real arena object");

// Rasterize player-radius navigation. Both spawns must connect, and the left
// spawn must be able to reach north, centre and south crossings at mid-map.
const step = 2;
const columns = Math.floor(game.map.width / step) + 1;
const rows = Math.floor(game.map.height / step) + 1;
const collidable = game.map.obstacles.filter((obstacle) => obstacle.collidable && !obstacle.dead);
const blocked = (x: number, y: number): boolean => {
    const pos = { x: x * step, y: y * step };
    if (pos.x < 2 || pos.y < 2 || pos.x > game.map.width - 2 || pos.y > game.map.height - 2) {
        return true;
    }
    return collidable.some((obstacle) => collider.intersectCircle(obstacle.collider, pos, 1.05));
};
const start = [Math.round(leftSpawn.x / step), Math.round(leftSpawn.y / step)] as const;
const target = [Math.round(rightSpawn.x / step), Math.round(rightSpawn.y / step)] as const;
const queue: Array<readonly [number, number]> = [start];
const seen = new Set([`${start[0]},${start[1]}`]);
const midBands = new Set<string>();
for (let index = 0; index < queue.length; index++) {
    const [x, y] = queue[index];
    const worldY = y * step;
    if (Math.abs(x * step - game.map.width / 2) <= step) {
        midBands.add(worldY < game.map.height * 0.375 ? "north" : worldY > game.map.height * 0.625 ? "south" : "centre");
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const nextX = x + dx;
        const nextY = y + dy;
        const key = `${nextX},${nextY}`;
        if (nextX < 0 || nextY < 0 || nextX >= columns || nextY >= rows || seen.has(key) || blocked(nextX, nextY)) continue;
        seen.add(key);
        queue.push([nextX, nextY]);
    }
}
assert(seen.has(`${target[0]},${target[1]}`), "both competitive spawns must remain path-connected");
assert.deepEqual([...midBands].sort(), ["centre", "north", "south"]);

function join(index: number, name: string) {
    const token = `v41-loadout-${index}`;
    game.addJoinToken(token, false, 1, 60_000, false, false, undefined, index);
    const msg = new JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = name;
    return game.playerBarn.addPlayer(`socket-${index}`, msg)!;
}
const left = join(0, "Left");
const right = join(1, "Right");
assert.deepEqual(left.weapons.slice(0, 2).map((weapon) => weapon.type), ["ak47", "mosin"]);
assert.deepEqual(right.weapons.slice(0, 2).map((weapon) => weapon.type), ["m39", "mp220"]);
assert.equal(game.started, true);
game.stop();

    assert.match(
    siteInfoSource,
    /#btns-duel-start"\)\.toggle\(this\.info\.duelRoomEnabled !== false\)/,
    "the private 1v1 room button must follow its independent room-mode switch",
);

console.log("V41 duel/room smoke test passed: independent duel switches, no AI wait, shared team-size caps, restored classic map and per-player weapons.");
}

void run();
