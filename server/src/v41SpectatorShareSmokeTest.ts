import assert from "node:assert/strict";
import {
    BitStream,
    SpectateMsg,
    SpectatorChatMsg,
    SpectatorOverlayMsg,
} from "../../shared/net/net.ts";
import { SpectatorShareError, SpectatorShareService } from "./spectatorShare.ts";
import type { GameData } from "./game/gameManager.ts";

const spectateOut = new SpectateMsg();
spectateOut.specFreeToggle = true;
spectateOut.specFreeActive = true;
spectateOut.freeCameraLayer = 3;
spectateOut.freeCameraPos = { x: 191.25, y: 72.5 };
spectateOut.freeCameraViewRadius = 144;
const spectateBits = new BitStream(new ArrayBuffer(64));
spectateOut.serialize(spectateBits);
assert.equal(spectateBits.index % 8, 0);
const spectateIn = new SpectateMsg();
spectateIn.deserialize(new BitStream(spectateBits.buffer));
assert.equal(spectateIn.freeCameraLayer, 3);
assert.ok(Math.abs(spectateIn.freeCameraPos.x - 191.25) < 0.1);
assert.ok(Math.abs(spectateIn.freeCameraPos.y - 72.5) < 0.1);

const overlayOut = new SpectatorOverlayMsg();
overlayOut.players = [
    {
        playerId: 17,
        pos: { x: 165.12, y: 72 },
        health: 63.4,
        weapon: "ak47",
        layer: 2,
        dead: false,
        downed: false,
    },
    {
        playerId: 18,
        pos: { x: 26.88, y: 72 },
        health: 0,
        weapon: "mosin",
        layer: 0,
        dead: true,
        downed: false,
    },
];
const overlayBits = new BitStream(new ArrayBuffer(256));
overlayOut.serialize(overlayBits);
assert.equal(overlayBits.index % 8, 0, "spectator overlay must preserve packet byte alignment");
const overlayIn = new SpectatorOverlayMsg();
overlayIn.deserialize(new BitStream(overlayBits.buffer));
assert.equal(overlayIn.players.length, 2);
assert.equal(overlayIn.players[0].playerId, 17);
assert.equal(overlayIn.players[0].weapon, "ak47");
assert.equal(overlayIn.players[0].layer, 2);
assert.ok(Math.abs(overlayIn.players[0].health - 63.4) < 0.6);
assert.equal(overlayIn.players[1].dead, true);

const chatOut = new SpectatorChatMsg();
chatOut.delivered = true;
chatOut.sender = "观众一号";
chatOut.text = "注意右侧沙袋后的敌人。".repeat(20);
const chatBits = new BitStream(new ArrayBuffer(512));
chatOut.serialize(chatBits);
assert.equal(chatBits.index % 8, 0);
const chatIn = new SpectatorChatMsg();
chatIn.deserialize(new BitStream(chatBits.buffer));
assert.equal(chatIn.delivered, true);
assert.equal(chatIn.sender, "观众一号");
assert.ok(new TextEncoder().encode(chatIn.text).length <= 180);
assert.ok(chatIn.text.length > 0);

const games = new Map<string, GameData>();
const id = "1".repeat(40);
games.set(id, {
    id,
    teamMode: 1,
    mapName: "duel",
    canJoin: true,
    aliveCount: 2,
    connectedCount: 2,
    humanPlayerCount: 2,
    aiPlayerCount: 0,
    spectatorCount: 0,
    serverBotCount: 0,
    serverBotTeamCounts: [],
    reservedHumanCount: 0,
    startedTime: 0,
    stopped: false,
    privateGame: true,
});
const shares = new SpectatorShareService((gameId) => games.get(gameId));
const code = shares.create(id);
assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
assert.equal(shares.create(id), code, "one active match should retain one stable share code");
assert.deepEqual(shares.resolve(code.toLowerCase()), { gameId: id, code });
assert.deepEqual(shares.resolve(code), { gameId: id, code }, "multiple viewers may resolve the same code");
games.get(id)!.stopped = true;
assert.throws(() => shares.resolve(code), SpectatorShareError);
assert.equal(shares.codeFor(id), undefined);

console.log("V41 spectator sharing smoke test passed: multi-view share code, free layer, global overlay and private chat protocol.");
