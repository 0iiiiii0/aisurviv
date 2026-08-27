import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const smartBotSource = fs.readFileSync(path.join(import.meta.dirname, "smartBot.ts"), "utf8");
const gameServerSource = fs.readFileSync(path.join(import.meta.dirname, "gameServer.ts"), "utf8");

const openSocketStart = smartBotSource.indexOf("private openSocket(): void");
const socketLostStart = smartBotSource.indexOf("private socketLost(reason: string)");
assert.ok(openSocketStart >= 0 && socketLostStart > openSocketStart);
const openSocketSource = smartBotSource.slice(openSocketStart, socketLostStart);
assert.doesNotMatch(
    openSocketSource,
    /reconnectAttempts\s*=\s*0/,
    "opening a WebSocket must not reset the reconnect budget before the join is accepted",
);

const socketMessageStart = smartBotSource.indexOf("private onSocketMessage(event: MessageEvent)");
const onMsgStart = smartBotSource.indexOf("private onMsg(type: number", socketMessageStart);
assert.ok(socketMessageStart >= 0 && onMsgStart > socketMessageStart);
const socketMessageSource = smartBotSource.slice(socketMessageStart, onMsgStart);
const dispatchIndex = socketMessageSource.indexOf("this.onMsg(type, msgStream.getStream());");
const alignIndex = socketMessageSource.indexOf("msgStream.getStream().readAlignToNextByte();");
assert.ok(
    dispatchIndex >= 0 && alignIndex > dispatchIndex,
    "the bot must consume per-message padding after dispatch and before decoding the next message",
);
assert.match(
    socketMessageSource,
    /if \(joinedPacketDecoded\) this\.reconnectAttempts = 0;/,
    "only a completely decoded initial packet may reset the reconnect budget",
);

assert.match(
    gameServerSource,
    /private stopBotProcesses\([\s\S]*?child\.kill\(\)/,
    "the game server must be able to terminate bot workers",
);
assert.match(
    gameServerSource,
    /if \(!game\) this\.stopBotProcesses\(gameId, "room-removed"\)/,
    "workers whose room was removed must be reclaimed",
);
assert.match(
    gameServerSource,
    /else if \(game\.stopped\) this\.stopBotProcesses\(gameId, "room-stopped"\)/,
    "workers from stopped rooms must be reclaimed",
);

console.log("bot worker lifecycle smoke test passed");
