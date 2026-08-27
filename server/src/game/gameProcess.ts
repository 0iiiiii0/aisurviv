import fs from "node:fs";
import { freemem, totalmem } from "node:os";
import path from "node:path";
import { App, SSLApp, type WebSocket } from "uWebSockets.js";
import type { GameWsDisconnectReason } from "../../../shared/types/api.ts";
import { Logger } from "../../../shared/utils/logger.ts";
import { isLocalNetworkAddress } from "../../../shared/utils/networkAddress.ts";
import { buildForbiddenContext } from "../bot/forbiddenServerContext.ts";
import { Config } from "../config.ts";
import { apiPrivateRouter, checkIp } from "../utils/apiRouter.ts";
import { logErrorToWebhook } from "../utils/logger.ts";
import { HTTPRateLimit, WebSocketRateLimit } from "../utils/rateLimit.ts";
import type { SaveGameBody } from "../utils/types.ts";
import { uwsHelpers } from "../utils/uwsHelpers.ts";
import type { Client } from "./client.ts";
import { Game } from "./game.ts";
import { GameFaultCircuitBreaker } from "./gameProcessHealth.ts";
import { type ProcessMsg, ProcessMsgType } from "./ipcTypes.ts";
import { ClientSocket } from "./socket.ts";

function sendMsg(msg: ProcessMsg) {
    if (!process.connected || !process.send) return;
    try {
        process.send(msg);
    } catch (error) {
        procLogger.error("Failed to send parent-process message", error);
    }
}

let game: ServerGame | undefined;
let gameWeakRef: WeakRef<ServerGame> | undefined;

const procLogger = new Logger(Config.logging, `GameProc-${process.pid}`);

function broadcastDisconnect(reason: GameWsDisconnectReason) {
    if (game) {
        for (const client of game.clientBarn.clients) {
            client.socket.close(reason);
        }
    }
}
process.on("disconnect", () => {
    broadcastDisconnect("server_restart");
    process.exit();
});

process.on("uncaughtException", async (err) => {
    console.error(err);
    broadcastDisconnect("server_crashed");

    game = undefined;
    await logErrorToWebhook("server", "Game process error", err);

    process.exit(1);
});

function stopGame() {
    game = undefined;

    // make sure game is properly free'd
    // we expose the gc on dev builds
    if (global.gc) {
        setImmediate(async () => {
            await global.gc!({
                execution: "async",
            });
            if (gameWeakRef?.deref()) {
                procLogger.warn("Possible memory leak found, something is keeping a reference to the game object!");
            }
        });
    }
}

//
// Keep saveGame and sendQuestProgress separated from the game class
// This ensures that waiting for the network request doesn't prevent the game instance from being GC'd
//

async function saveGame(gameId: string, values: SaveGameBody["matchData"]) {
    let res: Response | undefined = undefined;
    try {
        res = await apiPrivateRouter.save_game.$post({
            json: {
                matchData: values,
            },
        });
    } catch (err) {
        procLogger.error(`Failed to fetch API save game:`, err);
    }

    if (!res || !res.ok) {
        const region = Config.gameServer.thisRegion.toUpperCase();
        procLogger.error(
            `[${region}] Failed to save game data, saving locally instead`,
        );

        const dir = path.resolve("lost_game_data");
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir);
        }
        fs.writeFileSync(
            path.join(dir, `${gameId}.json`),
            JSON.stringify(values),
            "utf8",
        );
    }
}

async function sendQuestProgress(userId: string, progress: Array<{ id: string; delta: number }>) {
    try {
        const req = await apiPrivateRouter.quest_progress.$post({
            json: {
                userId,
                progress,
            },
        });
        const res = await req.json();
        if (!req.ok || !(res as { success: boolean }).success) {
            procLogger.error(`Failed to save quest progress`, res);
        }
    } catch (err) {
        procLogger.error(`Failed to save quest progress:`, err);
    }
}

/**
 * Implements methods only used when the game is actually running on a server
 */
class ServerGame extends Game {
    override updateData() {
        const arenaMatch = this.arenaMatch;
        sendMsg({
            type: ProcessMsgType.UpdateData,
            id: this.id,
            teamMode: this.teamMode,
            mapName: this.mapName,
            mapSeed: this.map.seed,
            canJoin: this.canJoin,
            aliveCount: this.aliveCount,
            connectedCount: this.connectedCount,
            humanPlayerCount: this.humanPlayerCount,
            pendingHumanCount: this.pendingHumanCount,
            aiPlayerCount: this.aiPlayerCount,
            spectatorCount: this.spectatorCount,
            serverBotCount: this.serverBotCount,
            contestantAdmissionCount: this.contestantAdmissionCount,
            serverBotTeamCounts: this.serverBotTeamCounts,
            reservedHumanCount: this.reservedHumanCount,
            reservedBotCount: this.reservedBotCount,
            startedTime: this.startedTime,
            stopped: this.stopped,
            over: this.over,
            privateGame: this.privateGame,
            pureAiMatch: this.pureAiMatch,
            zombieDifficulty: this.zombieDifficulty,
            extractionSecretEnabled: this.extractionSecretEnabled,
            duelAdrenalineEnabled: this.duelAdrenalineEnabled,
            arenaRound: arenaMatch?.currentRound,
            totalRounds: arenaMatch?.totalRounds,
            arenaScores: arenaMatch
                ? Object.fromEntries(arenaMatch.scores)
                : undefined,
            timeRunning: this.timeRunning,
            livingPlayers: this.playerBarn.livingPlayers.map(p => {
                return {
                    id: p.__id,
                    userId: p.userId,
                    name: p.name,
                    disconnected: p.disconnected,
                };
            }),
        });
        if (this.stopped) {
            stopGame();
        }
    }

    override _saveGameToDatabase() {
        // don't save games that never started
        if (!this.started) return;

        const players = this.modeManager.getPlayersSortedByRank();
        /**
         * teamTotal is for total teams that started the match, i hope?
         *
         * it also seems to be unused by the client so we could also remove it?
         */
        const teamTotal = new Set(players.map(({ player }) => player.teamId)).size;

        const teamKills = players.reduce(
            (acc, curr) => {
                acc[curr.player.teamId] = (acc[curr.player.teamId] ?? 0) + curr.player.kills;
                return acc;
            },
            {} as Record<string, number>,
        );

        const values: SaveGameBody["matchData"] = players.map(({ player, rank }) => {
            return {
                // *NOTE: userId is optional; we save the game stats for non logged users too
                userId: player.userId,
                region: Config.gameServer.thisRegion,
                username: player.name,
                playerId: player.matchDataId,
                teamMode: this.teamMode,
                teamCount: player.group?.players.length ?? 1,
                teamTotal: teamTotal,
                teamId: player.teamId,
                timeAlive: Math.round(player.timeAlive),
                died: player.dead,
                kills: player.kills,
                team_kills: teamKills[player.groupId] ?? 0,
                damageDealt: Math.round(player.damageDealt),
                damageTaken: Math.round(player.damageTaken),
                killerId: player.killedBy?.matchDataId || 0,
                gameId: this.id,
                mapId: this.map.mapId,
                mapSeed: this.map.seed,
                killedIds: player.killedIds,
                rank: rank,
                ip: player.client.ip,
                findGameIp: player.client.findGameIp,
                role: player.role,
            };
        });

        // only save the game if it has more than 2 players lol
        if (values.length < 2) return;
        saveGame(this.id, values);
    }

    override sendQuestProgress(userId: string, progress: Array<{ id: string; delta: number }>) {
        sendQuestProgress(userId, progress);
    }
}

let lastMsgTime = Date.now();
let pausedUntil = 0;
const updateBreaker = new GameFaultCircuitBreaker();
const netSyncBreaker = new GameFaultCircuitBreaker();

function runGuarded(
    stage: "update" | "netSync",
    breaker: GameFaultCircuitBreaker,
    callback: () => void,
): void {
    if (Date.now() < pausedUntil) return;
    try {
        callback();
        breaker.success();
    } catch (error) {
        const decision = breaker.failure();
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        pausedUntil = Math.max(pausedUntil, Date.now() + decision.pauseMs);
        procLogger.error(`${stage} fault: ${message}`, error);
        sendMsg({
            type: ProcessMsgType.Fault,
            gameId: game?.id ?? "unknown",
            at: Date.now(),
            stage,
            message,
            stack,
            fatal: decision.fatal,
            consecutive: decision.consecutive,
            recent: decision.recent,
        });
        if (decision.fatal && game && !game.stopped) game.stop();
    }
}

process.on("message", (msg: ProcessMsg) => {
    lastMsgTime = Date.now();

    if (msg.type === ProcessMsgType.Create && !game) {
        game = new ServerGame(msg.id, msg.config);
        gameWeakRef = new WeakRef(game);
    }

    if (!game) return;

    switch (msg.type) {
        case ProcessMsgType.AddJoinToken:
            if (msg.legacyToken) {
                game.addJoinToken(
                    msg.legacyToken.token,
                    msg.autoFill,
                    msg.legacyToken.playerCount,
                    msg.legacyToken.expiresInMs,
                    msg.legacyToken.spectator,
                    msg.legacyToken.serverBot,
                    msg.legacyToken.serverBotTeamIds,
                    msg.legacyToken.duelLoadoutIndex,
                );
                // A browser can reach the room port faster than this child
                // consumes IPC, especially in a busy externally-computed
                // faction match. Confirm installation before the parent
                // exposes the credential to the browser.
                sendMsg({
                    type: ProcessMsgType.JoinTokenAck,
                    requestId: msg.legacyToken.requestId,
                });
            } else {
                game.addJoinTokens(msg.tokens, msg.autoFill);
            }
            break;
        case ProcessMsgType.AddSpectateToken:
            game.addSpectateToken(msg.token, msg.data);
            break;
        case ProcessMsgType.RemoveJoinToken:
            game.removeJoinToken(msg.token);
            break;
        case ProcessMsgType.ForbiddenContextRequest:
            if (!game.stopped) {
                sendMsg({
                    type: ProcessMsgType.ForbiddenContextResponse,
                    requestId: msg.requestId,
                    payload: buildForbiddenContext(
                        game,
                        msg.botPlayerId,
                        msg.sequence,
                        msg.difficulty,
                    ),
                });
            }
            break;
    }
});

setInterval(() => {
    if (Date.now() - lastMsgTime > 45_000) {
        console.log("Game process has not received a message in 45 seconds, exiting");
        process.exit();
    }

    if (game) {
        game?.updateData();
    } else {
        sendMsg({
            type: ProcessMsgType.KeepAlive,
        });
    }
}, 5000);

setInterval(() => {
    if (game && !game.stopped) runGuarded("update", updateBreaker, () => game?.update());
}, 1000 / Config.gameTps);

setInterval(() => {
    if (game && !game.stopped) runGuarded("netSync", netSyncBreaker, () => game?.netSync());
}, 1000 / Config.netSyncTps);

let previousResourceCpu = process.cpuUsage();
let previousResourceWall = performance.now();
let cpuPressureSince = 0;
let memoryPressureSince = 0;
setInterval(() => {
    const wallNow = performance.now();
    const wallElapsedMs = Math.max(1, wallNow - previousResourceWall);
    const currentCpu = process.cpuUsage();
    const cpuElapsedMicros = Math.max(
        0,
        currentCpu.user - previousResourceCpu.user + currentCpu.system - previousResourceCpu.system,
    );
    const cpuPercent = cpuElapsedMicros / 1000 / wallElapsedMs * 100;
    previousResourceCpu = currentCpu;
    previousResourceWall = wallNow;

    if (!game || game.stopped) {
        cpuPressureSince = 0;
        memoryPressureSince = 0;
        return;
    }

    const now = Date.now();
    const cpuThreshold = Math.max(50, Math.min(100, Number(Config.serverCpuPressurePercent) || 95));
    if (cpuPercent >= cpuThreshold) {
        if (!cpuPressureSince) cpuPressureSince = now;
        const duration = now - cpuPressureSince;
        if (duration >= Math.max(500, Number(Config.serverCpuPressureDurationMs) || 2_000)) {
            game.reportServerOverload("cpu", `game process CPU ${cpuPercent.toFixed(1)}% for ${duration}ms`);
        }
    } else {
        cpuPressureSince = 0;
    }

    const memory = process.memoryUsage();
    const freeRatio = totalmem() > 0 ? freemem() / totalmem() : 1;
    const rssMb = memory.rss / (1024 * 1024);
    const memoryHigh = freeRatio <= Math.max(
        0.005,
        Math.min(0.25, Number(Config.serverSystemFreeMemoryRatio) || 0.03),
    ) || rssMb >= Math.max(256, Number(Config.serverProcessRssLimitMb) || 2_048);
    if (memoryHigh) {
        if (!memoryPressureSince) memoryPressureSince = now;
        const duration = now - memoryPressureSince;
        if (duration >= Math.max(500, Number(Config.serverMemoryPressureDurationMs) || 2_000)) {
            game.reportServerOverload(
                "memory",
                `rss=${rssMb.toFixed(0)}MB systemFree=${(freeRatio * 100).toFixed(1)}% for ${duration}ms`,
            );
        }
    } else {
        memoryPressureSince = 0;
    }
}, 1_000);

interface GameSocketData {
    ip: string;
    rateLimitTracked: boolean;
    rateLimit: Record<symbol, number>;
    disconnectReason?: GameWsDisconnectReason;
    clientSocket?: UwsSocket;
}

class UwsSocket extends ClientSocket<Client> {
    private _socket: WebSocket<GameSocketData>;
    private _ip: string;

    _closed = false;
    constructor(socket: WebSocket<GameSocketData>, ip: string) {
        super();
        this._socket = socket;
        this._ip = ip;
    }

    ip(): string {
        return this._ip;
    }

    closed(): boolean {
        return this._closed;
    }

    override bufferedAmount(): number {
        return this._closed ? 0 : this._socket.getBufferedAmount();
    }

    send(data: Uint8Array<ArrayBuffer>): void {
        if (this._closed) return;
        this._socket.send(data, true, false);
    }

    close(reason?: GameWsDisconnectReason): void {
        if (this._closed) return;
        this._closed = true;
        this._socket.end(reason ? 3000 : 0, reason);
    }
}

const app = Config.gameServer.ssl
    ? SSLApp({
        key_file_name: Config.gameServer.ssl.keyFile,
        cert_file_name: Config.gameServer.ssl.certFile,
    })
    : App();

const gameHTTPRateLimit = new HTTPRateLimit(5, 1000);
const gameWsRateLimit = new WebSocketRateLimit(500, 1000, 5);

app.ws<GameSocketData>("/play", {
    idleTimeout: 30,
    maxPayloadLength: 1024,

    async upgrade(res, req, context): Promise<void> {
        res.onAborted((): void => {
            res.aborted = true;
        });
        const wskey = req.getHeader("sec-websocket-key");
        const wsProtocol = req.getHeader("sec-websocket-protocol");
        const wsExtensions = req.getHeader("sec-websocket-extensions");

        if (!game) {
            procLogger.warn("Websocket upgrade closed: process not running a game");
            res.end();
            return;
        }

        const ip = uwsHelpers.getIp(res, req, Config.gameServer.proxyIPHeader);

        if (!ip) {
            game.logger.warn("Invalid IP Found");
            res.end();
            return;
        }

        // Smart-bot workers connect from loopback and can legitimately exceed
        // the public per-IP connection cap in large/faction rooms.
        const trustedInternalClient = isLocalNetworkAddress(ip);
        if (
            !trustedInternalClient
            && (gameHTTPRateLimit.isRateLimited(ip) || gameWsRateLimit.isIpRateLimited(ip))
        ) {
            res.cork(() => {
                game!.logger.warn("Websocket upgrade closed: Rate limited");
                res.writeStatus("429 Too Many Requests");
                res.write("429 Too Many Requests");
                res.end();
            });
            return;
        }

        if (!trustedInternalClient) gameWsRateLimit.ipConnected(ip);

        let disconnectReason: GameWsDisconnectReason | undefined = undefined;

        const ipData = trustedInternalClient ? undefined : await checkIp(ip);

        if (ipData?.banned) {
            disconnectReason = "ip_banned";
        } else if (ipData?.behindProxy) {
            disconnectReason = "behind_proxy";
        }

        if (res.aborted) return;
        res.cork(() => {
            if (res.aborted) return;
            res.upgrade<GameSocketData>(
                {
                    rateLimit: {},
                    ip,
                    rateLimitTracked: !trustedInternalClient,
                    disconnectReason,
                    clientSocket: undefined as unknown as UwsSocket,
                },
                wskey,
                wsProtocol,
                wsExtensions,
                context,
            );
        });
    },

    open(socket: WebSocket<GameSocketData>) {
        const data = socket.getUserData();

        if (data.disconnectReason) {
            socket.end(3000, data.disconnectReason);
            return;
        }

        data.clientSocket = new UwsSocket(socket, data.ip);
    },

    message(socket: WebSocket<GameSocketData>, message) {
        const data = socket.getUserData();
        if (!game || !data.clientSocket) {
            if (data.clientSocket) {
                data.clientSocket.close();
            } else {
                socket.close();
            }
            return;
        }
        if (gameWsRateLimit.isRateLimited(socket.getUserData().rateLimit)) {
            procLogger.warn("Game websocket rate limited, closing socket.");
            socket.end(3000, "rate_limited");
            return;
        }
        game.clientBarn.handleMsg(message, data.clientSocket);
    },

    close(socket: WebSocket<GameSocketData>) {
        const data = socket.getUserData();
        if (data.rateLimitTracked) gameWsRateLimit.ipDisconnected(data.ip);
        if (data.clientSocket) {
            data.clientSocket._closed = true;
            game?.clientBarn?.handleSocketClose(data.clientSocket);
        }
    },
});

const port = parseInt(process.argv[2]);

app.listen(Config.gameServer.host, port, 1, (socket) => {
    if (!socket) {
        throw new Error(`Port ${port} is already in use`);
    }

    procLogger.info(
        `Listening on ${Config.gameServer.host}:${port}`,
    );
});
