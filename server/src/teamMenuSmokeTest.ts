import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
    normalizeTeamRoomUrl,
    TEAM_KEEP_ALIVE_INTERVAL_SECONDS,
    TEAM_SOCKET_IDLE_TIMEOUT_SECONDS,
    type RoomData,
} from "../../shared/net/team";
import { TeamMode } from "../../shared/gameConfig.ts";
import { Config, configPath } from "./config.ts";
import {
    isMatchmakingPlaylistAvailable,
    isPublicPlaylistAvailable,
} from "./game/gameManager.ts";
import { TeamMenu, type TeamSocketData } from "./teamMenu.ts";
import type { ApiServer } from "./apiServer";

type SentMessage = { type: string; data: unknown };

function socket(
    ip: string,
    accountToken = "",
): TeamSocketData & { sent: SentMessage[]; closed: boolean } {
    const sent: SentMessage[] = [];
    const data = {
        sent,
        closed: false,
        roomUrl: "",
        rateLimit: {},
        ip,
        accountToken,
        sendMsg(response: string) {
            sent.push(JSON.parse(response) as SentMessage);
        },
        closeSocket() {
            data.closed = true;
        },
    };
    return data;
}

function message(type: string, data: unknown): ArrayBuffer {
    return new TextEncoder().encode(JSON.stringify({ type, data })).buffer;
}

function latestState(client: ReturnType<typeof socket>) {
    const state = [...client.sent].reverse().find((entry) => entry.type === "state");
    assert.ok(state, "client should receive a team state");
    return state.data as {
        localPlayerId: number;
        room: RoomData;
        players: Array<{ name: string; isLeader: boolean }>;
    };
}

async function run(): Promise<void> {
    assert.equal(normalizeTeamRoomUrl("Ab12"), "#Ab12");
    assert.equal(normalizeTeamRoomUrl("#Ab12"), "#Ab12");
    assert.equal(normalizeTeamRoomUrl("https://game.example/#Ab12"), "#Ab12");
    assert.equal(normalizeTeamRoomUrl("%23Ab12"), "#Ab12");
    assert.equal(normalizeTeamRoomUrl("bad-code"), null);
    assert.ok(
        TEAM_KEEP_ALIVE_INTERVAL_SECONDS < TEAM_SOCKET_IDLE_TIMEOUT_SECONDS,
        "team keepalive must run before the socket idle timeout",
    );

    const duoIdx = Config.modes.findIndex(
        (mode) => mode.mapName === "main" && mode.teamMode === TeamMode.Duo,
    );
    assert.ok(duoIdx >= 0, "main duo playlist must exist");
    const duo = Config.modes[duoIdx];
    // Do not depend on the production default for Main Duo. V256+ may keep
    // public playlists enabled; this test only needs a synthetic closed queue
    // to verify that invite teams can still start an unlisted team playlist.
    const closedDuo = { ...duo, enabled: false };
    assert.equal(isMatchmakingPlaylistAvailable(closedDuo, false), false);
    assert.equal(
        isMatchmakingPlaylistAvailable(closedDuo, true),
        true,
        "an invite team may start an unlisted playlist in production mode",
    );
    assert.equal(isPublicPlaylistAvailable(closedDuo, false), false);
    assert.equal(
        isPublicPlaylistAvailable(closedDuo, true),
        true,
        "the all-modes entry may start an unlisted non-extraction playlist",
    );
    assert.equal(
        isPublicPlaylistAvailable({ ...closedDuo, mapName: "extraction" }, true),
        false,
        "the all-modes entry must never bypass extraction availability",
    );
    assert.equal(
        isPublicPlaylistAvailable({ ...closedDuo, mapName: "extraction", enabled: true }, true),
        false,
        "the all-modes entry must not route through an enabled extraction playlist",
    );
    assert.equal(
        isPublicPlaylistAvailable({ ...closedDuo, mapName: "extraction_secret" }, true),
        false,
        "the all-modes entry must never bypass secret extraction availability",
    );

    const findCalls: Array<Record<string, unknown>> = [];
    const fakeServer = {
        playerAccounts: { profile: () => null },
        logger: { warn: () => undefined },
        async findGame(body: Record<string, unknown>) {
            findCalls.push(body);
            return {
                res: [
                    {
                        zone: "",
                        gameId: "team-smoke-game",
                        hosts: ["127.0.0.1"],
                        addrs: ["127.0.0.1"],
                        data: "shared-team-token",
                        useHttps: false,
                    },
                ],
            };
        },
    } as unknown as ApiServer;
    const menu = new TeamMenu(fakeServer);
    const leader = socket("203.0.113.5");
    const teammate = socket("203.0.113.5");
    const roomData = {
        roomUrl: "",
        findingGame: false,
        lastError: "",
        region: "local",
        autoFill: true,
        enabledGameModeIdxs: [],
        // Starting from solo reproduces the normal main-menu create path; the
        // server must fall back to the invite-code duo playlist.
        gameModeIdx: 0,
        maxPlayers: 1,
    } satisfies RoomData;

    await menu.handleMsg(
        message("create", { roomData, playerData: { name: "Leader" } }),
        leader,
    );
    assert.match(leader.roomUrl, /^#[A-Za-z0-9]{4}$/);
    const created = latestState(leader);
    assert.equal(created.room.gameModeIdx, duoIdx);
    assert.equal(created.room.maxPlayers, TeamMode.Duo);

    await menu.handleMsg(
        message("join", {
            // A copied URL used to become ##CODE on the server.
            roomUrl: `https://game.example/${leader.roomUrl}`,
            playerData: { name: "Teammate" },
        }),
        teammate,
    );
    assert.equal(teammate.roomUrl, leader.roomUrl);
    assert.equal(latestState(leader).players.length, 2);
    assert.equal(latestState(teammate).players.length, 2);

    // A duplicate/stale close callback must not splice(-1) and evict a real
    // teammate from the room.
    const stale = socket("203.0.113.5");
    stale.roomUrl = leader.roomUrl;
    assert.equal(menu.removePlayer(stale), false);
    assert.equal(menu.rooms.get(leader.roomUrl)?.players.length, 2);

    await menu.handleMsg(
        message("playGame", {
            version: 999,
            region: "local",
            zones: ["local"],
        }),
        leader,
    );
    assert.equal(findCalls.length, 1);
    assert.equal(findCalls[0].teamRoom, true);
    assert.equal(findCalls[0].playerCount, 2);
    assert.ok(leader.sent.some((entry) => entry.type === "joinGame"));
    assert.ok(teammate.sent.some((entry) => entry.type === "joinGame"));

    assert.equal(menu.removePlayer(leader), true);
    assert.equal(menu.rooms.get(teammate.roomUrl)?.players.length, 1);
    assert.equal(latestState(teammate).players[0].isLeader, true);
    assert.equal(menu.removePlayer(teammate), true);
    assert.equal(menu.rooms.size, 0);

    // A failed matchmaking attempt keeps the party alive, clears the busy
    // state and allows the leader to retry instead of getting stuck forever.
    const failingMenu = new TeamMenu({
        playerAccounts: { profile: () => null },
        logger: { warn: () => undefined },
        async findGame() {
            return { res: [{ err: "matchmaking temporarily unavailable" }] };
        },
    } as unknown as ApiServer);
    const retryLeader = socket("198.51.100.9");
    await failingMenu.handleMsg(
        message("create", { roomData, playerData: { name: "RetryLeader" } }),
        retryLeader,
    );
    await failingMenu.handleMsg(
        message("playGame", {
            version: 999,
            region: "local",
            zones: ["local"],
        }),
        retryLeader,
    );
    const retryState = latestState(retryLeader);
    assert.equal(retryState.room.findingGame, false);
    assert.equal(retryState.room.lastError, "find_game_error");
    assert.equal(failingMenu.rooms.size, 1);

    // Regression: logging in after a normal team room opened used to leave an
    // empty token frozen on the socket. The UI then looked logged in while an
    // extraction mode switch/start was rejected as a guest.
    const extractionDuoIdx = Config.modes.findIndex(
        (mode) => mode.mapName === "extraction" && mode.teamMode === TeamMode.Duo,
    );
    assert.ok(extractionDuoIdx >= 0, "extraction duo playlist must exist");
    const validSessions = new Set(["leader-session", "teammate-session"]);
    const extractionFindCalls: Array<Record<string, unknown>> = [];
    const authMenu = new TeamMenu({
        playerAccounts: {
            profile(token: unknown) {
                return validSessions.has(String(token))
                    ? { username: String(token), displayName: String(token) }
                    : null;
            },
        },
        logger: { warn: () => undefined },
        async findGame(body: Record<string, unknown>) {
            extractionFindCalls.push(body);
            return {
                res: [{
                    zone: "",
                    gameId: "extraction-team-smoke",
                    hosts: ["127.0.0.1"],
                    addrs: ["127.0.0.1"],
                    data: "extraction-team-token",
                    useHttps: false,
                }],
            };
        },
    } as unknown as ApiServer);
    const authLeader = socket("192.0.2.41");
    const authTeammate = socket("192.0.2.42");
    await authMenu.handleMsg(
        message("create", { roomData, playerData: { name: "AuthLeader" } }),
        authLeader,
    );
    await authMenu.handleMsg(
        message("join", {
            roomUrl: authLeader.roomUrl,
            playerData: { name: "AuthTeammate" },
        }),
        authTeammate,
    );
    const extractionRoomProps = {
        ...latestState(authLeader).room,
        gameModeIdx: extractionDuoIdx,
    };
    await authMenu.handleMsg(
        message("setRoomProps", extractionRoomProps),
        authLeader,
    );
    assert.notEqual(
        latestState(authLeader).room.gameModeIdx,
        extractionDuoIdx,
        "guest team members must still be blocked from extraction",
    );

    await authMenu.handleMsg(
        message("updateAccount", { accountToken: "leader-session" }),
        authLeader,
    );
    await authMenu.handleMsg(
        message("updateAccount", { accountToken: "teammate-session" }),
        authTeammate,
    );
    await authMenu.handleMsg(
        message("setRoomProps", extractionRoomProps),
        authLeader,
    );
    assert.equal(
        latestState(authLeader).room.gameModeIdx,
        extractionDuoIdx,
        "members who log in after opening the room must be accepted",
    );
    await authMenu.handleMsg(
        message("playGame", {
            version: 999,
            region: "local",
            zones: ["local"],
            accountToken: "leader-session",
        }),
        authLeader,
    );
    assert.equal(extractionFindCalls.length, 1);
    assert.equal(extractionFindCalls[0].accountToken, "leader-session");
    assert.ok(authLeader.sent.some((entry) => entry.type === "joinGame"));
    assert.ok(authTeammate.sent.some((entry) => entry.type === "joinGame"));

    // V260.4 regression: exercise the exact secret-extraction squad path.
    // Previous coverage stopped at duo, so a hard-coded two-use token / four-player
    // account issue could pass every smoke test without ever touching players 3/4.
    const secretSquadIdx = Config.modes.findIndex(
        (mode) =>
            mode.mapName === "extraction_secret" && mode.teamMode === TeamMode.Squad,
    );
    assert.ok(secretSquadIdx >= 0, "secret extraction squad playlist must exist");
    const squadSessions = new Set([
        "secret-leader-session",
        "secret-two-session",
        "secret-three-session",
        "secret-four-session",
    ]);
    const squadFindCalls: Array<Record<string, unknown>> = [];
    const squadMenu = new TeamMenu({
        playerAccounts: {
            profile(token: unknown) {
                return squadSessions.has(String(token))
                    ? { username: String(token), displayName: String(token) }
                    : null;
            },
        },
        logger: { warn: () => undefined },
        async findGame(body: Record<string, unknown>) {
            squadFindCalls.push(body);
            return {
                res: [{
                    zone: "",
                    gameId: "secret-squad-smoke",
                    hosts: ["127.0.0.1"],
                    addrs: ["127.0.0.1"],
                    data: "secret-squad-token",
                    useHttps: false,
                }],
            };
        },
    } as unknown as ApiServer);
    const squadSockets = [
        socket("192.0.2.71", "secret-leader-session"),
        socket("192.0.2.72", "secret-two-session"),
        socket("192.0.2.73", "secret-three-session"),
        socket("192.0.2.74", "secret-four-session"),
    ];
    await squadMenu.handleMsg(
        message("create", {
            roomData: { ...roomData, gameModeIdx: secretSquadIdx },
            playerData: {
                name: "SecretLeader",
                accountToken: "secret-leader-session",
            },
        }),
        squadSockets[0],
    );
    for (let i = 1; i < squadSockets.length; i++) {
        await squadMenu.handleMsg(
            message("join", {
                roomUrl: squadSockets[0].roomUrl,
                playerData: {
                    name: `SecretP${i + 1}`,
                    accountToken: [
                        "secret-leader-session",
                        "secret-two-session",
                        "secret-three-session",
                        "secret-four-session",
                    ][i],
                },
            }),
            squadSockets[i],
        );
    }
    const secretSquadState = latestState(squadSockets[0]);
    assert.equal(secretSquadState.room.gameModeIdx, secretSquadIdx);
    assert.equal(secretSquadState.room.maxPlayers, TeamMode.Squad);
    assert.equal(secretSquadState.players.length, 4);

    // Expire only player 4. The logged-in leader must NOT be told that the
    // leader itself is logged out; login_required belongs to the invalid socket.
    squadSessions.delete("secret-four-session");
    const leaderLoginErrorsBefore = squadSockets[0].sent.filter(
        (entry) => entry.type === "error" &&
            (entry.data as { type?: string }).type === "login_required",
    ).length;
    await squadMenu.handleMsg(
        message("playGame", {
            version: 999,
            region: "local",
            zones: ["local"],
            accountToken: "secret-leader-session",
        }),
        squadSockets[0],
    );
    assert.equal(squadFindCalls.length, 0, "invalid squad member must block matchmaking");
    assert.equal(
        squadSockets[0].sent.filter(
            (entry) => entry.type === "error" &&
                (entry.data as { type?: string }).type === "login_required",
        ).length,
        leaderLoginErrorsBefore,
        "valid leader must not receive a teammate's login_required",
    );
    assert.ok(
        squadSockets[3].sent.some(
            (entry) => entry.type === "error" &&
                (entry.data as { type?: string }).type === "login_required",
        ),
        "only the expired fourth member should receive login_required",
    );

    // Restore player 4 and prove all four members proceed through playGame.
    squadSessions.add("secret-four-session");
    await squadMenu.handleMsg(
        message("updateAccount", { accountToken: "secret-four-session" }),
        squadSockets[3],
    );
    await squadMenu.handleMsg(
        message("playGame", {
            version: 999,
            region: "local",
            zones: ["local"],
            accountToken: "secret-leader-session",
        }),
        squadSockets[0],
    );
    assert.equal(squadFindCalls.length, 1);
    assert.equal(squadFindCalls[0].gameModeIdx, secretSquadIdx);
    assert.equal(squadFindCalls[0].playerCount, 4);
    assert.equal(squadFindCalls[0].teamRoom, true);
    assert.equal(squadFindCalls[0].accountToken, "secret-leader-session");
    for (const memberSocket of squadSockets) {
        assert.ok(
            memberSocket.sent.some((entry) => entry.type === "joinGame"),
            "all four secret squad members must receive the same joinGame",
        );
    }

    // V260.3 regression: a cached/older browser can reach /team_v2 with a
    // valid HttpOnly session cookie while omitting (or sending a stale) token
    // in its first create message. The server must use the Upgrade cookie as
    // a fallback instead of incorrectly returning login_required.
    const cookieMenu = new TeamMenu({
        playerAccounts: {
            profile(token: unknown) {
                return token === "cookie-session"
                    ? { username: "cookie-user", displayName: "CookieUser" }
                    : null;
            },
        },
        logger: { warn: () => undefined },
        async findGame() {
            return { res: [{ err: "full" }] };
        },
    } as unknown as ApiServer);
    const cookieLeader = socket("192.0.2.60", "cookie-session");
    await cookieMenu.handleMsg(
        message("create", {
            roomData: { ...roomData, gameModeIdx: extractionDuoIdx },
            playerData: {
                name: "CookieLeader",
                // Deliberately stale: cookie fallback must win.
                accountToken: "stale-local-storage-token",
            },
        }),
        cookieLeader,
    );
    assert.ok(
        cookieLeader.sent.some((entry) => entry.type === "state"),
        "valid WebSocket session cookie must authenticate extraction create",
    );
    assert.ok(
        !cookieLeader.sent.some(
            (entry) =>
                entry.type === "error" &&
                (entry.data as { type?: string }).type === "login_required",
        ),
        "cookie-authenticated extraction create must not emit login_required",
    );

    const clientTeamSource = fs.readFileSync(
        path.resolve(configPath, "client/src/ui/teamMenu.ts"),
        "utf8",
    );
    assert.match(
        clientTeamSource,
        /syncAccountToken\(\)[\s\S]*?sendMessage\("updateAccount"/,
        "the browser team room must publish login changes without reconnecting",
    );
    assert.match(
        clientTeamSource,
        /accountToken:\s*this\.getAccountToken\(\)/,
        "Play must carry the leader's latest session to close the click/login race",
    );

    console.log("team menu smoke test passed");
}

void run();
