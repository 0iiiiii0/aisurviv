import assert from "node:assert/strict";
import { BitStream, SpectateMsg } from "../../shared/net/net.ts";
import { GameModeManager } from "./game/gameModeManager.ts";
import { planMixedBotDifficulties } from "./botDifficulty.ts";
import {
    isDuelAiDifficulty,
    isPublicAiDifficulty,
    normalizeDuelAiDifficulty,
} from "./duelLoadout.ts";

const writeStream = new BitStream(new ArrayBuffer(32));
const outgoing = new SpectateMsg();
outgoing.specFreeToggle = true;
outgoing.specFreeActive = true;
outgoing.freeCameraPos = { x: 321.5, y: 654.25 };
outgoing.freeCameraViewRadius = 111;
outgoing.serialize(writeStream);

const readStream = new BitStream(writeStream.buffer);
const incoming = new SpectateMsg();
incoming.deserialize(readStream);
assert.equal(incoming.specFreeToggle, true);
assert.equal(incoming.specFreeActive, true);
assert.ok(Math.abs(incoming.freeCameraPos.x - outgoing.freeCameraPos.x) < 0.1);
assert.ok(Math.abs(incoming.freeCameraPos.y - outgoing.freeCameraPos.y) < 0.1);
assert.ok(Math.abs(incoming.freeCameraViewRadius - 111) < 1);

const observer = { spectatorOnly: true } as any;
const botOne = { serverBot: true, dead: false, disconnected: false, spectatorOnly: false };
const humanOne = { serverBot: false, dead: false, disconnected: false, spectatorOnly: false };
const botTwo = { serverBot: true, dead: false, disconnected: false, spectatorOnly: false };
const humanTwo = { serverBot: false, dead: false, disconnected: false, spectatorOnly: false };
const manager = new GameModeManager({
    teamMode: 1,
    map: { factionMode: false },
    playerBarn: { livingPlayers: [botOne, humanOne, botTwo, humanTwo] },
} as any);
assert.deepEqual(
    manager.getSpectatablePlayers(observer).map((player: any) => player.serverBot),
    [false, false, true, true],
    "automatic spectator ordering must prefer human players",
);

const first = planMixedBotDifficulties(
    100,
    0,
    { normal: 40, hard: 30, pro: 20, legit: 10 },
);
assert.equal(first.nextCursor, 100);
assert.deepEqual(
    Object.fromEntries(
        ["normal", "hard", "pro", "legit"].map((difficulty) => [
            difficulty,
            first.difficulties.filter((value) => value === difficulty).length,
        ]),
    ),
    { normal: 40, hard: 30, pro: 20, legit: 10 },
);
assert.equal(first.difficulties.includes("forbidden" as never), false);
assert.equal(isDuelAiDifficulty("easy"), false);
assert.equal(isDuelAiDifficulty("pro"), true);
assert.equal(isDuelAiDifficulty("legit"), true);
assert.equal(isDuelAiDifficulty("forbidden"), true);
assert.equal(isPublicAiDifficulty("legit"), true);
assert.equal(isPublicAiDifficulty("forbidden"), false);
assert.equal(normalizeDuelAiDifficulty("easy"), "normal");

console.log("Spectator/free-camera and mixed difficulty smoke test passed.");
