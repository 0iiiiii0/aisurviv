import assert from "assert/strict";
import fs from "fs";
import path from "path";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Game } from "./game/game.ts";
import type { JoinTokenData } from "./game/game.ts";
import { NoOpSocket } from "./game/socket.ts";
import type { Client } from "./game/client.ts";
import type { Player } from "./game/objects/player.ts";

// Source-level guarantees: the smart-bot worker must reconnect with backoff and
// the game server must tolerate + eventually clean up disconnected players.
const smartBotSource = fs.readFileSync(
    path.join(import.meta.dirname, "smartBot.ts"),
    "utf8",
) + "\n" + fs.readFileSync(path.join(import.meta.dirname, "bot", "smartBotSupport.ts"), "utf8");
assert.match(
    smartBotSource,
    /private openSocket\(\): void/,
    "smartBot must own a reusable socket opener",
);
assert.match(
    smartBotSource,
    /private socketLost\(reason: string\): void/,
    "smartBot must handle transient socket loss",
);
assert.match(
    smartBotSource,
    /private scheduleReconnect\(reason: string\): void/,
    "smartBot must schedule a bounded reconnect",
);
assert.match(
    smartBotSource,
    /BOT_RECONNECT_ATTEMPTS/,
    "reconnect attempt budget must be configurable",
);
assert.match(
    smartBotSource,
    /checkConnectionWatchdog\(timestamp: number\): void/,
    "smartBot must detect half-open sockets via a packet watchdog",
);
assert.match(
    smartBotSource,
    /this\.terminate\(msg\.gameOver \? "won" : "died"/,
    "game over must terminate the bot without reconnecting",
);

const gameSource = fs.readFileSync(
    path.join(import.meta.dirname, "game", "game.ts"),
    "utf8",
);
assert.match(
    gameSource,
    /disconnectCleanupTicker/,
    "game must periodically clean up disconnected players",
);
assert.match(
    gameSource,
    /GameConfig\.player\.disconnectTimeout/,
    "disconnect cleanup must use the configured timeout",
);
assert.match(
    gameSource,
    /player\.serverBot\s*\?\s*GameConfig\.player\.disconnectTimeout/,
    "disconnected bots must be kept for the configured disconnect timeout so they can resume",
);

const playerSource = fs.readFileSync(
    path.join(import.meta.dirname, "game", "objects", "player.ts"),
    "utf8",
);
assert.match(
    playerSource,
    /player\.team\.removePlayer\(player\)/,
    "removing a player must also remove it from its faction team",
);
assert.match(
    playerSource,
    /candidate\.matchPriv !== joinMsg\.matchPriv/,
    "reconnect must match the join token to resume the same contestant",
);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 断线后用同一 match token 重连：不重新创建 token（真实 smart-bot 只复用
 * matchPriv），并复用最初加入时保存的 token 数据走 tryReconnectClient 路径。
 */
function join(
    game: Game,
    savedData: Map<string, JoinTokenData>,
    socketId: string,
    token: string,
    name: string,
    teamId: number,
): Player {
    game.addJoinToken(token, true, 1, 60_000, false, true, [teamId]);
    const data = game.joinTokens.get(token)?.data as JoinTokenData;
    (data as JoinTokenData & { socketId?: string }).socketId = socketId;
    savedData.set(token, data);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.joinToken = token;
    msg.matchPriv = token;
    msg.name = name;
    msg.bot = true;
    const client = game.clientBarn.addClientWithPlayer(new NoOpSocket(), data, msg, token);
    assert(client?.player, "player must join");
    return client.player;
}

function resume(
    game: Game,
    savedData: Map<string, JoinTokenData>,
    socketId: string,
    token: string,
    name: string,
): Player {
    const data = { ...savedData.get(token)! } as JoinTokenData & { socketId?: string };
    data.socketId = socketId;
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = name;
    msg.bot = true;
    const rebound = game.clientBarn.tryReconnectClient(
        new NoOpSocket() as never,
        token,
        msg,
        data,
    );
    assert.equal(rebound, true, "reconnect must be accepted");
    const player = game.playerBarn.players.find((candidate) => candidate.matchPriv === token);
    assert(player, "resumed player must stay in the match");
    return player;
}

/** A disconnected contestant rejoining with the same token resumes the same object. */
async function runSoloResume(): Promise<void> {
    const game = new Game("reconnect-resume", {
        mapName: "main",
        teamMode: TeamMode.Solo,
    });
    await Promise.resolve();
    const savedData = new Map<string, JoinTokenData>();
    const original = join(game, savedData, "sock-a", "token-resume", "Bot-A", 1);
    const firstSocket = original.client.socket;

    game.clientBarn.handleSocketClose(firstSocket as never);
    assert.equal(original.disconnected, true, "bot must be marked disconnected");
    assert.equal(original.disconnectAt > 0, true, "disconnect time must be recorded");
    assert.equal(
        game.playerBarn.players.includes(original),
        true,
        "a bot must stay in the match so it can resume",
    );

    const resumed = resume(game, savedData, "sock-b", "token-resume", "Bot-A");
    assert.equal(resumed, original, "reconnect must return the exact same player object");
    assert.equal(original.disconnected, false, "resume must clear the disconnected flag");
    assert.equal(original.disconnectAt, 0, "resume must clear the disconnect time");
    assert.notEqual(original.client.socket, firstSocket, "resume must bind a fresh connection");
    const sameTokenCount = game.playerBarn.players.filter(
        (p) => p.matchPriv === "token-resume",
    ).length;
    assert.equal(sameTokenCount, 1, "resume must never create a duplicate contestant");
    game.stop();
}

/** Faction bots that never come back are removed after the timeout and free their team. */
async function runFactionCleanup(): Promise<void> {
    const game = new Game("reconnect-cleanup", {
        mapName: "faction",
        teamMode: TeamMode.Squad,
    });
    await Promise.resolve();
    const savedData = new Map<string, JoinTokenData>();
    const a = join(game, savedData, "sock-a", "token-a", "TeamA-1", 1);
    const b = join(game, savedData, "sock-b", "token-b", "TeamA-2", 1);
    const c = join(game, savedData, "sock-c", "token-c", "TeamB-1", 2);
    assert.equal(game.modeManager.aliveCount(), 2, "both factions must be alive");

    for (const player of [a, b] as Player[]) {
        game.clientBarn.handleSocketClose(player.client.socket as never);
    }
    assert.equal(a.disconnected, true);
    assert.equal(b.disconnected, true);
    const timeoutMs = GameConfig.player.disconnectTimeout * 1000;
    a.disconnectAt = Date.now() - timeoutMs - 1000;
    b.disconnectAt = Date.now() - timeoutMs - 1000;

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        game.update();
        if (!game.playerBarn.players.includes(a) && !game.playerBarn.players.includes(b)) break;
        await sleep(40);
    }
    assert.equal(game.playerBarn.players.includes(a), false, "team A bot 1 must be cleaned up");
    assert.equal(game.playerBarn.players.includes(b), false, "team A bot 2 must be cleaned up");
    assert.equal(game.modeManager.aliveCount(), 1, "only team B remains after cleanup");
    assert.equal(game.playerBarn.getAliveTeams().length, 1, "removed bots must not linger in their team");
    game.stop();
}

async function main(): Promise<void> {
    await runSoloResume();
    await runFactionCleanup();
    console.log(
        "Bot disconnect recovery smoke test passed: resume keeps the same player, and abandoned bots are cleaned up after the timeout.",
    );
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});
