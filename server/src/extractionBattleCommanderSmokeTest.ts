import assert from "node:assert/strict";
import * as net from "../../shared/net/net.ts";
import {
    ExtractionBattleCommander,
    type ExtractionCommanderBot,
    type ExtractionCommanderEntry,
    type ExtractionCommanderObstacle,
} from "./bot/extractionBattleCommander.ts";
import {
    ExtractionBattlePhase,
    ExtractionBattleRole,
} from "../../shared/net/extractionHumanHintMsg.ts";

const commander = new ExtractionBattleCommander();
const human = { id: 900, pos: { x: 100, y: 100 }, layer: 1 };
const entries: ExtractionCommanderEntry[] = [
    {
        kind: "stair",
        id: 101,
        pos: { x: 80, y: 100 },
        downDir: { x: 1, y: 0 },
        structureId: 11,
        stairIndex: 0,
        layer: 0,
    },
    {
        kind: "stair",
        id: 102,
        pos: { x: 120, y: 100 },
        downDir: { x: -1, y: 0 },
        structureId: 12,
        stairIndex: 0,
        layer: 0,
    },
    {
        kind: "stair",
        id: 103,
        pos: { x: 100, y: 72 },
        downDir: { x: 0, y: 1 },
        structureId: 13,
        stairIndex: 1,
        layer: 0,
    },
];
const obstacle: ExtractionCommanderObstacle = {
    id: 501,
    type: "ammo_crate_box",
    pos: { x: 91, y: 100 },
    layer: 1,
    dead: false,
    destructible: true,
    collision: { type: 1, min: { x: 89.5, y: 98.5 }, max: { x: 92.5, y: 101.5 } },
};
const bots: ExtractionCommanderBot[] = Array.from({ length: 8 }, (_, index) => ({
    id: index + 1,
    pos: { x: 45 + index * 3, y: 55 + (index % 2) * 6 },
    layer: 0,
    health: 100,
    hasGun: true,
}));
// Only two legacy hunter slots are configured. Central command must still
// assign the rest of the same-faction AI real tactical roles.
const assaultBotIds = new Set(bots.slice(0, 2).map((bot) => bot.id));
const frame = (timestamp: number, frameBots: ExtractionCommanderBot[]) => ({
    timestamp,
    bots: frameBots,
    humans: [human],
    assaultBotIds,
    entries,
    obstacles: [obstacle],
    mapWidth: 200,
    mapHeight: 200,
});

const assemble = commander.update(frame(0, bots));
assert.equal(assemble.length, bots.length, "every secret-extraction AI must receive a global order");
assert.ok(assemble.every((order) => order.phase === ExtractionBattlePhase.Assemble));
assert.ok(
    new Set(assemble.map((order) => order.entryStructureId)).size >= 2,
    "the commander must distribute the force across multiple real entrances",
);
assert.ok(assemble.some((order) => order.role === ExtractionBattleRole.Suppressor));
assert.ok(assemble.some((order) => order.role === ExtractionBattleRole.Breacher));
assert.ok(assemble.some((order) => order.role === ExtractionBattleRole.Flanker));
assert.ok(assemble.some((order) => order.role === ExtractionBattleRole.RearCutoff));
assert.ok(
    assemble
        .filter((order) => !assaultBotIds.has(order.botId))
        .every((order) => order.role !== ExtractionBattleRole.Reserve),
    "non-vanguard faction members must still participate in the central plan",
);
assert.ok(
    assemble.some(
        (order) => order.role === ExtractionBattleRole.Clearer && order.clearObstacleId === obstacle.id,
    ),
    "a corridor ammo box must be reserved for one global clearer",
);

const stagedBots = bots.map((bot) => {
    const order = assemble.find((candidate) => candidate.botId === bot.id)!;
    return {
        ...bot,
        pos: { x: order.objectiveX, y: order.objectiveY },
        layer: order.objectiveLayer,
    };
});
const suppress = commander.update(frame(1_200, stagedBots));
assert.ok(suppress.every((order) => order.phase === ExtractionBattlePhase.Suppress));
assert.ok(
    suppress
        .filter((order) => order.role === ExtractionBattleRole.Suppressor)
        .every((order) => order.objectiveLayer === 1),
    "suppressors must cross to the target floor before blind suppression",
);

const damagedBots = stagedBots.map((bot, index) => ({
    ...bot,
    health: index === 0 ? 72 : bot.health,
}));
const breach = commander.update(frame(1_750, damagedBots));
assert.ok(breach.every((order) => order.phase === ExtractionBattlePhase.Breach));
assert.equal(
    breach.find((order) => order.botId === damagedBots[0].id)?.underFireResponse,
    true,
    "damage to one bot must be visible in the next global command frame",
);

const breachedBots = damagedBots.map((bot, index) => ({
    ...bot,
    layer: index < 4 ? 1 : bot.layer,
    pos: index < 4 ? { x: 94 + index * 2, y: 100 } : bot.pos,
}));
const sweep = commander.update(frame(2_100, breachedBots));
assert.ok(sweep.every((order) => order.phase === ExtractionBattlePhase.Sweep));
assert.ok(
    new Set(sweep.map((order) => `${Math.round(order.objectiveX)}:${Math.round(order.objectiveY)}`)).size >= 5,
    "the sweep must surround the target instead of stacking every bot on one point",
);

const message = new net.ExtractionHumanHintMsg();
message.humans = [{ id: human.id, x: human.pos.x, y: human.pos.y, layer: human.layer }];
message.hunterBotIds = [...assaultBotIds];
message.battleOrders = sweep;
const writeStream = new net.MsgStream(new ArrayBuffer(4_096));
writeStream.serializeMsg(net.MsgType.ExtractionHumanHint, message);
const readStream = new net.MsgStream(Uint8Array.from(writeStream.getBuffer()).buffer);
assert.equal(readStream.deserializeMsgType(), net.MsgType.ExtractionHumanHint);
const restored = new net.ExtractionHumanHintMsg();
restored.deserialize(readStream.getStream());
assert.deepEqual(restored.humans, message.humans);
assert.deepEqual(restored.hunterBotIds, message.hunterBotIds);
assert.equal(restored.battleOrders.length, message.battleOrders.length);
for (let index = 0; index < message.battleOrders.length; index++) {
    const actual = restored.battleOrders[index];
    const expected = message.battleOrders[index];
    assert.deepEqual(
        {
            ...actual,
            objectiveX: expected.objectiveX,
            objectiveY: expected.objectiveY,
            fireX: expected.fireX,
            fireY: expected.fireY,
        },
        expected,
        `battle order ${index} control fields must survive the worker protocol`,
    );
    assert.ok(Math.abs(actual.objectiveX - expected.objectiveX) < 0.001);
    assert.ok(Math.abs(actual.objectiveY - expected.objectiveY) < 0.001);
    assert.ok(Math.abs(actual.fireX - expected.fireX) < 0.001);
    assert.ok(Math.abs(actual.fireY - expected.fireY) < 0.001);
}

console.log("Extraction battle commander smoke test passed");
