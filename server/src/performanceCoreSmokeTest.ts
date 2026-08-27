import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ObjectType } from "../../shared/net/objectSerializeFns.ts";
import {
    ObjectPool,
    type GameObject,
    SharedStaticObjectPool,
} from "./bot/smartBotSupport.ts";
import { hasAuthoritativeMatchmakingCapacity } from "./game/gameProcessManager.ts";

const root = path.resolve(import.meta.dirname, "../..");
const gameProcessSource = fs.readFileSync(
    path.join(root, "server/src/game/gameProcess.ts"),
    "utf8",
);
const gameServerSource = fs.readFileSync(
    path.join(root, "server/src/gameServer.ts"),
    "utf8",
);
const clientSource = fs.readFileSync(
    path.join(root, "server/src/game/client.ts"),
    "utf8",
);
const gameSource = fs.readFileSync(
    path.join(root, "server/src/game/game.ts"),
    "utf8",
);
const smartBotSource = fs.readFileSync(
    path.join(root, "server/src/smartBot.ts"),
    "utf8",
);

assert.equal(gameProcessSource.includes("NanoTimer"), false, "Windows room loop must not busy-spin");
assert.match(gameProcessSource, /game && !game\.stopped/, "stopped rooms must skip hot ticks");
assert.match(gameServerSource, /bot-autofill-paused/, "CPU hard limit must gate auto-fill");
assert.match(gameServerSource, /revokeJoinToken\(game\.id, join\.data\)/, "failed bot spawn must revoke its token");
assert.match(clientSource, /deferNetworkFrameIfBackpressured/, "slow peers must drop obsolete snapshots");
assert.equal(
    clientSource.includes("evictOneAiForHuman"),
    false,
    "normal extraction humans must append without evicting AI",
);
assert.equal(
    gameSource.includes("evictOneAiForHuman"),
    false,
    "AI eviction must not remain available through another admission path",
);
assert.equal(
    /config\.extractionMode\s*&&\s*(?:this\.)?(?:playerInfos|get\(|isExtractionBot)/.test(smartBotSource),
    false,
    "normal extraction must not suppress AI-vs-AI targeting",
);
assert.match(
    smartBotSource,
    /config\.extractionSecret\s*&&\s*this\.isExtractionBot/,
    "secret extraction must still treat AI as allies",
);

assert.equal(hasAuthoritativeMatchmakingCapacity("extraction", 0, 1), true);
assert.equal(hasAuthoritativeMatchmakingCapacity("extraction_secret", 0, 1), false);
assert.equal(hasAuthoritativeMatchmakingCapacity("main", 1, 1), true);
assert.equal(hasAuthoritativeMatchmakingCapacity("main", 0, 1), false);

const pool = new ObjectPool();
pool.updateObjFull(ObjectType.Player, 1, { pos: { x: 1, y: 1 } } as never);
const first = pool.values(ObjectType.Player);
const second = pool.values(ObjectType.Player);
assert.equal(first, second, "unchanged type queries must reuse the cached array");
pool.updateObjFull(ObjectType.Obstacle, 2, { pos: { x: 2, y: 2 } } as never);
assert.notEqual(pool.values(ObjectType.Player), first, "membership changes must invalidate caches");
pool.deleteObj(1);
assert.equal(pool.values(ObjectType.Player).length, 0);
pool.clear();
assert.equal(pool.values().length, 0);

const sharedWorld = new SharedStaticObjectPool();
const botA = new ObjectPool(sharedWorld);
const botB = new ObjectPool(sharedWorld);
const sharedObstacle = botA.updateObjFull(
    ObjectType.Obstacle,
    100,
    { pos: { x: 10, y: 20 }, healthT: 1 } as never,
);
assert.equal(botB.getObjById(100), sharedObstacle, "same-match bots must share one static object");
botB.updateObjPart(100, { pos: { x: 11, y: 20 } } as never);
assert.equal(botA.getObjById(100)?.data.pos.x, 11, "shared topology updates must be immediately visible");
botB.deleteObj(100);
assert.equal(botA.getObjById(100), sharedObstacle, "one viewport deletion must not erase shared topology");
botA.updateObjFull(ObjectType.Player, 200, { pos: { x: 1, y: 1 } } as never);
assert.equal(botB.getObjById(200), undefined, "dynamic player views must remain bot-local");
botA.clear();
assert.equal(botA.getObjById(100), sharedObstacle, "reconnect must retain the match world");
assert.equal(botA.getObjById(200), undefined, "reconnect must clear bot-local dynamics");

const sixtyBotWorld = new SharedStaticObjectPool();
const sixtyBots = Array.from({ length: 60 }, () => new ObjectPool(sixtyBotWorld));
for (const bot of sixtyBots) {
    for (let id = 1; id <= 500; id++) {
        bot.updateObjFull(
            ObjectType.Obstacle,
            id,
            { pos: { x: id % 25, y: Math.floor(id / 25) } } as never,
        );
    }
}
assert.equal(
    Object.keys(sixtyBotWorld.idToObj).length,
    500,
    "60 same-match bots must retain one 500-object static world, not 30,000 copies",
);
assert.ok(sixtyBots.every((bot) => Object.keys(bot.idToObj).length === 0));

void ({} as GameObject);
console.log("performance core smoke test passed");
