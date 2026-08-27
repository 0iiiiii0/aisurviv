import assert from "assert";
import fs from "fs";
import path from "path";
import { GameProcessManager } from "./game/gameProcessManager.ts";
import { getIp } from "./utils/serverHelpers.ts";

const processManagerSource = fs.readFileSync(
    path.join(__dirname, "game/gameProcessManager.ts"),
    "utf8",
);
assert.match(
    processManagerSource,
    /!proc\.stopped[\s\S]{0,180}heartbeatState\(proc\.lastMsgTime\) === "healthy"/,
    "matchmaking must reject stopped or stale room processes",
);
assert.match(
    processManagerSource,
    /game = await this\.createGame\(createServerGameConfig\(mode\)\) as GameProcess/,
    "new matchmaking rooms must use the timeout-aware creation path",
);
assert.doesNotMatch(
    processManagerSource,
    /if \(game\.stopped\) \{[\s\S]{0,220}onCreatedCbs\.push/,
    "findGame must not wait forever on an already stopped room",
);


async function verifyStoppedRoomRollover(): Promise<void> {
    const manager = Object.create(GameProcessManager.prototype) as any;
    let staleTokenCount = 0;
    let replacementTokenCount = 0;
    let createCount = 0;
    const staleRoom = {
        stopped: true,
        terminalHandled: false,
        process: { connected: true },
        isConnected: () => true,
        lastMsgTime: Date.now(),
        canJoin: true,
        privateGame: false,
        avaliableSlots: 20,
        teamMode: 1,
        mapName: "main",
        startedTime: 1,
        addJoinToken: () => { staleTokenCount++; },
    };
    const replacementRoom = {
        id: "replacement-room",
        stopped: false,
        terminalHandled: false,
        process: { connected: true },
        isConnected: () => true,
        addJoinToken: () => { replacementTokenCount++; },
    };
    manager.processes = [staleRoom];
    manager.createGame = async () => {
        createCount++;
        return replacementRoom;
    };

    const result = await manager.findGame({
        region: "local",
        zones: [],
        version: 0,
        gameModeIdx: 0,
        autoFill: true,
        playerCount: 1,
    });
    assert.equal(createCount, 1, "a stopped room must force creation/reuse of a replacement room");
    assert.equal(staleTokenCount, 0, "a stopped room must never receive a new join token");
    assert.equal(replacementTokenCount, 1, "the replacement room receives the join token");
    assert.equal(result.gameId, "replacement-room");
}

const bytes = (value: string) => new TextEncoder().encode(value).buffer;
const fakeResponse = (direct: string, proxied = "") => ({
    getRemoteAddressAsText: () => bytes(direct),
    getProxiedRemoteAddressAsText: () => bytes(proxied),
});
const fakeRequest = (headers: Record<string, string>) => ({
    getHeader: (name: string) => headers[name.toLowerCase()] ?? "",
});

assert.equal(
    getIp(
        fakeResponse("127.0.0.1") as never,
        fakeRequest({ "x-forwarded-for": "203.0.113.9, 127.0.0.1" }) as never,
    ),
    "203.0.113.9",
    "loopback reverse proxy requests must be limited by the real client IP",
);
assert.equal(
    getIp(
        fakeResponse("198.51.100.4") as never,
        fakeRequest({ "x-forwarded-for": "203.0.113.9" }) as never,
    ),
    "198.51.100.4",
    "direct public clients must not be allowed to spoof forwarding headers",
);
assert.equal(
    getIp(fakeResponse("127.0.0.1", "192.0.2.8") as never),
    "192.0.2.8",
    "PROXY protocol addresses remain authoritative",
);

const apiSource = fs.readFileSync(path.join(__dirname, "apiServer.ts"), "utf8");
assert.match(apiSource, /AbortSignal\.timeout\(8_000\)/, "region forwarding must time out");
assert.match(apiSource, /getIp\(res, req\)/, "find-game rate limiting must use proxy headers safely");
assert.match(apiSource, /Retry-After/, "rate-limited clients need an explicit retry window");

const gameServerSource = fs.readFileSync(path.join(__dirname, "gameServer.ts"), "utf8");
assert.match(
    gameServerSource,
    /API find_game error:[\s\S]{0,220}matchmaking temporarily unavailable/,
    "game-server matchmaking failures must return JSON instead of hanging",
);
assert.match(
    gameServerSource,
    /needy\.sort\(\(a, b\) => b\.deficit - a\.deficit\)/,
    "extraction replenish must prioritize the room with the largest AI deficit when the global bot-worker cap is reached",
);
assert.match(
    gameServerSource,
    /搜打撤补员：\$\{skippedForLimit\} 个真人局因全局 worker 上限暂缓/,
    "extraction replenish must log when the global bot-worker cap defers a human room",
);

async function verifyReadinessSorting(): Promise<void> {
    const manager = Object.create(GameProcessManager.prototype) as any;
    const tokenCounts: Record<string, number> = {};
    const makeRoom = (
        id: string,
        humanPlayerCount: number,
        serverBotCount: number,
        startedTime: number,
        mapName = "main",
    ) => ({
        id,
        stopped: false,
        terminalHandled: false,
        process: { connected: true },
        isConnected: () => true,
        lastMsgTime: Date.now(),
        canJoin: true,
        privateGame: false,
        avaliableSlots: 10,
        teamMode: 1,
        mapName,
        humanPlayerCount,
        serverBotCount,
        reservedHumanCount: 0,
        startedTime,
        addJoinToken: () => { tokenCounts[id] = (tokenCounts[id] ?? 0) + 1; },
    });
    // The oldest room is empty; a newer room already has humans and bots; a
    // near-expiry extraction room (7 minutes in, 3 left) must be skipped.
    const emptyOld = makeRoom("empty-old", 0, 0, 10);
    const populated = makeRoom("populated", 2, 5, 60);
    const expiring = makeRoom("expiring", 3, 10, 420, "extraction");
    manager.processes = [emptyOld, populated, expiring];
    manager.createGame = async () => { throw new Error("no replacement room expected"); };

    const result = await manager.findGame({
        region: "local",
        zones: [],
        version: 0,
        gameModeIdx: 0,
        autoFill: true,
        playerCount: 1,
    });
    assert.equal(
        result.gameId,
        "populated",
        "matchmaking must prefer a populated room and never send a player into a match with <5 minutes left",
    );
    assert.deepEqual(tokenCounts, { populated: 1 }, "near-expiry rooms must not receive join tokens");
    assert.ok(result.fill, "public matchmaking response should carry a fill snapshot");
    assert.equal(result.fill!.totalPlayers, 7);
    assert.equal(result.fill!.humanPlayers, 2);
    assert.equal(result.fill!.botPlayers, 5);
    assert.ok(result.fill!.targetPlayers >= 1);
}

void Promise.all([verifyStoppedRoomRollover(), verifyReadinessSorting()]).then(() => {
    console.log("V53 matchmaking recovery smoke test passed");
});
