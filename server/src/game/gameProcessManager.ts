import { type ChildProcess, fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { type MapDefKey, MapDefs } from "../../../shared/defs/mapDefs.ts";
import type { TeamMode } from "../../../shared/gameConfig.ts";
import { util } from "../../../shared/utils/util.ts";
import { roomFillSnapshot } from "../botAutoFill.ts";
import { Config } from "../config.ts";
import { ServerLogger } from "../utils/logger.ts";
import { type FindGamePrivateBody, type SpectateGamePrivateBody } from "../utils/types.ts";
import type { SpectateTokenData } from "./game.ts";
import {
    compareMatchmakingReadiness,
    createServerGameConfig,
    type FindGameResponse,
    type GameData,
    GameManager,
    isMatchmakingPlaylistAvailable,
    type LegacyFindGameBody,
    type ServerGameConfig,
} from "./gameManager.ts";
import { type GameData as IpcGameData, type ProcessFaultMsg, type ProcessMsg, ProcessMsgType } from "./ipcTypes.ts";

let procFile: string;
let procArgv: string[];

if (import.meta.filename.endsWith(".ts")) {
    procFile = "src/game/gameProcess.ts";
    procArgv = ["--expose-gc", "--import", "tsx"];
} else {
    // Reused production workers can retain a previous room's expanded V8 heap
    // for a long time. gameProcess drops the room root and explicitly collects
    // it on stop; expose GC here so that path is active outside development too.
    procArgv = ["--expose-gc"];
    procFile = "dist/gameProcess.js";
}

export enum ProcState {
    Idle,
    CreatingGame,
    Running,
}

type ProcessGameData = GameData & IpcGameData;

type ExtendedProcessUpdate =
    & Partial<IpcGameData>
    & Pick<
        IpcGameData,
        | "id"
        | "teamMode"
        | "mapName"
        | "canJoin"
        | "aliveCount"
        | "startedTime"
        | "stopped"
        | "timeRunning"
        | "livingPlayers"
    >;

interface LegacyJoinTokenPayload {
    token: string;
    playerCount: number;
    expiresInMs: number;
    spectator: boolean;
    serverBot: boolean;
    serverBotTeamIds?: readonly number[];
    duelLoadoutIndex?: number;
}

/** Build the same immutable room config for public and process matchmaking. */
export function createProcessMatchmakingGameConfig(
    mode: Pick<ServerGameConfig, "mapName" | "teamMode">,
    zombieDifficulty?: "simple" | "normal" | "hard",
): ServerGameConfig {
    return createServerGameConfig(mode, zombieDifficulty);
}

/** Zombie difficulty is part of the queue identity. */
export function processRoomMatchesZombieDifficulty(
    mapName: string,
    roomDifficulty: "simple" | "normal" | "hard" | undefined,
    requestedDifficulty: "simple" | "normal" | "hard" | undefined,
): boolean {
    return mapName !== "zombie"
        || (roomDifficulty ?? "normal") === (requestedDifficulty ?? "normal");
}

/** Normal extraction treats its AI target as soft capacity, so humans may append. */
export function hasAuthoritativeMatchmakingCapacity(
    mapName: string,
    availableSlots: number,
    requestedSlots: number,
): boolean {
    return mapName === "extraction" || availableSlots >= Math.max(1, requestedSlots);
}

export class GameProcess {
    process: ChildProcess;
    port: number;

    gameData: ProcessGameData = {
        id: "",
        teamMode: 0 as TeamMode,
        mapName: "" as MapDefKey,
        mapSeed: 0,
        canJoin: false,
        aliveCount: 0,
        connectedCount: 0,
        humanPlayerCount: 0,
        pendingHumanCount: 0,
        aiPlayerCount: 0,
        spectatorCount: 0,
        serverBotCount: 0,
        contestantAdmissionCount: 0,
        serverBotTeamCounts: [],
        reservedHumanCount: 0,
        reservedBotCount: 0,
        startedTime: 0,
        stopped: false,
        over: false,
        privateGame: false,
        pureAiMatch: false,
        zombieDifficulty: "normal",
        extractionSecretEnabled: false,
        timeRunning: 0,
        livingPlayers: [],
    };

    lastFault: ProcessFaultMsg | undefined;

    get processHealth(): GameData["processHealth"] {
        if (this.lastFault && Date.now() - this.lastFault.at <= 60_000) return "fault";
        return Date.now() - this.lastMsgTime > 15_000 ? "warning" : "healthy";
    }

    state = ProcState.Idle;

    createdTime = Date.now();

    stoppedTime = Date.now();
    lastMsgTime = Date.now();

    manager: GameProcessManager;

    onCreatedCbs: Array<(_proc: typeof this) => void> = [];

    avaliableSlots = 0;
    private maxSlots = 1;

    reusedCount = 0;

    private readonly pendingJoinTokenAcks = new Map<
        string,
        {
            resolve: () => void;
            reject: (error: Error) => void;
            timer: ReturnType<typeof setTimeout>;
        }
    >();

    constructor(
        manager: GameProcessManager,
        id: string,
        config: ServerGameConfig,
        port: number,
    ) {
        this.manager = manager;
        this.port = port;

        this.process = fork(procFile, [port.toString()], {
            serialization: "advanced",
            execArgv: procArgv,
        });

        this.process.on("message", (msg: ProcessMsg) => {
            this._onProcessMsg(msg);
        });
        const rejectPendingJoinTokens = () => {
            for (const pending of this.pendingJoinTokenAcks.values()) {
                clearTimeout(pending.timer);
                pending.reject(new Error("Game process exited before installing join token"));
            }
            this.pendingJoinTokenAcks.clear();
        };
        this.process.once("exit", rejectPendingJoinTokens);
        this.process.once("disconnect", rejectPendingJoinTokens);

        this.create(id, config);
    }

    private _onProcessMsg(msg: ProcessMsg) {
        if (msg.type) {
            this.lastMsgTime = Date.now();
        }

        switch (msg.type) {
            case ProcessMsgType.UpdateData: {
                const update = msg as ExtendedProcessUpdate;
                if (this.gameData.id !== msg.id) {
                    // A reused worker can have the previous room's final update
                    // in flight. Never remap the process to that old id and
                    // resurrect a ghost room in the admin dashboard.
                    this.manager.logger.warn(
                        `[stale-room-snapshot-ignored] process=${this.process.pid} expected=${
                            this.gameData.id.slice(0, 8)
                        } received=${msg.id.slice(0, 8)}`,
                    );
                    break;
                }
                if (this.state === ProcState.CreatingGame && msg.canJoin) {
                    this.state = ProcState.Running;
                    for (const cb of this.onCreatedCbs) {
                        cb(this);
                    }
                    this.onCreatedCbs.length = 0;
                    if (this.reusedCount === 1) {
                        this.manager.logger.info(
                            `Process ${this.process.pid} created in ${Date.now() - this.createdTime}ms`,
                        );
                    }
                }

                this.gameData = {
                    ...this.gameData,
                    ...update,
                    connectedCount: update.connectedCount ?? this.gameData.connectedCount,
                    humanPlayerCount: update.humanPlayerCount ?? this.gameData.humanPlayerCount,
                    aiPlayerCount: update.aiPlayerCount ?? this.gameData.aiPlayerCount,
                    spectatorCount: update.spectatorCount ?? this.gameData.spectatorCount,
                    serverBotCount: update.serverBotCount ?? this.gameData.serverBotCount,
                    serverBotTeamCounts: update.serverBotTeamCounts
                        ? [...update.serverBotTeamCounts]
                        : this.gameData.serverBotTeamCounts,
                    reservedHumanCount: update.reservedHumanCount ?? this.gameData.reservedHumanCount,
                    reservedBotCount: update.reservedBotCount ?? this.gameData.reservedBotCount,
                    privateGame: update.privateGame ?? this.gameData.privateGame,
                    processHealth: this.processHealth,
                    processPid: this.process.pid,
                    lastProcessFault: this.lastFault
                        ? {
                            at: this.lastFault.at,
                            stage: this.lastFault.stage,
                            message: this.lastFault.message,
                            fatal: this.lastFault.fatal,
                            consecutive: this.lastFault.consecutive,
                            recent: this.lastFault.recent,
                        }
                        : undefined,
                };
                this.avaliableSlots = Math.max(
                    0,
                    this.maxSlots
                        - this.gameData.contestantAdmissionCount
                        - this.gameData.reservedHumanCount
                        - (this.gameData.reservedBotCount ?? 0),
                );
                if (this.gameData.stopped) {
                    this.stoppedTime = Date.now();
                    this.state = ProcState.Idle;
                }
                break;
            }
            case ProcessMsgType.Fault:
                this.lastFault = msg;
                this.manager.logger.warn(
                    `Game ${this.gameData.id} ${msg.fatal ? "fatal " : ""}fault in ${msg.stage}: ${msg.message}`,
                );
                break;
            case ProcessMsgType.ForbiddenContextResponse:
                this.manager.resolveForbiddenContext(msg.requestId, msg.payload);
                break;
            case ProcessMsgType.JoinTokenAck: {
                const pending = this.pendingJoinTokenAcks.get(msg.requestId);
                if (!pending) break;
                clearTimeout(pending.timer);
                this.pendingJoinTokenAcks.delete(msg.requestId);
                pending.resolve();
                break;
            }
        }
    }

    send(msg: ProcessMsg) {
        if (this.process.killed || !this.process.channel) return;
        this.process.send(msg);
    }

    create(id: string, config: ServerGameConfig) {
        this.lastFault = undefined;
        this.createdTime = Date.now();
        this.lastMsgTime = Date.now();
        this.send({
            type: ProcessMsgType.Create,
            id,
            config,
        });
        this.gameData.id = id;
        this.gameData.teamMode = config.teamMode;
        this.gameData.mapName = config.mapName;
        this.gameData.stopped = false;
        this.gameData.over = false;
        this.gameData.privateGame = Boolean(config.privateGame);
        this.gameData.pureAiMatch = Boolean(config.pureAiMatch);
        this.gameData.zombieDifficulty = config.zombieDifficulty ?? "normal";
        this.gameData.extractionSecretEnabled = Boolean(config.extractionSecretEnabled);
        this.gameData.connectedCount = 0;
        this.gameData.humanPlayerCount = 0;
        this.gameData.aiPlayerCount = 0;
        this.gameData.spectatorCount = 0;
        this.gameData.serverBotCount = 0;
        this.gameData.serverBotTeamCounts = [];
        this.gameData.reservedHumanCount = 0;
        this.gameData.reservedBotCount = 0;
        this.state = ProcState.CreatingGame;

        const mapDef = MapDefs[this.gameData.mapName as MapDefKey];
        this.maxSlots = Math.max(
            1,
            Math.floor(config.maxPlayersOverride ?? mapDef.gameMode.maxPlayers),
        );
        this.avaliableSlots = this.maxSlots;

        this.reusedCount++;
    }

    addJoinTokens(tokens: FindGamePrivateBody["playerData"], autoFill: boolean) {
        this.send({
            type: ProcessMsgType.AddJoinToken,
            autoFill,
            tokens,
        });
        this.avaliableSlots = Math.max(0, this.avaliableSlots - tokens.length);
    }

    addLegacyJoinToken(
        payload: LegacyJoinTokenPayload,
        autoFill: boolean,
        timeoutMs = 10_000,
    ): Promise<void> {
        const requestId = `${this.gameData.id}:join:${randomBytes(6).toString("hex")}`;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingJoinTokenAcks.delete(requestId);
                reject(new Error("Game process did not confirm join token in time"));
            }, timeoutMs);
            timer.unref?.();
            this.pendingJoinTokenAcks.set(requestId, { resolve, reject, timer });
            this.send({
                type: ProcessMsgType.AddJoinToken,
                autoFill,
                tokens: [],
                legacyToken: {
                    ...payload,
                    requestId,
                },
            });
            if (!payload.spectator) {
                this.avaliableSlots = Math.max(
                    0,
                    this.avaliableSlots - Math.max(1, payload.playerCount),
                );
            }
        });
    }

    addSpectateToken(token: string, data: SpectateTokenData) {
        this.send({
            type: ProcessMsgType.AddSpectateToken,
            token,
            data,
        });
    }

    removeJoinToken(token: string): void {
        this.send({ type: ProcessMsgType.RemoveJoinToken, token });
    }
}

export class GameProcessManager extends GameManager {
    readonly processById = new Map<string, GameProcess>();
    readonly processes: GameProcess[] = [];

    readonly logger = new ServerLogger("Game Process Manager");

    private readonly _freePorts: number[] = [];

    private readonly pendingForbiddenContext = new Map<
        string,
        { resolve: (payload: unknown | null) => void; timer: ReturnType<typeof setTimeout> }
    >();

    getNextPort() {
        return this._freePorts.shift();
    }

    constructor() {
        super();
        for (let i = 0; i < Config.gameServer.maxGames; i++) {
            this._freePorts.push(Config.gameServer.firstGamePort + i);
        }

        // always keep some processes running even if theres no active games on them
        // creating a new proc is more expensive than reusing one
        const minIdleProcs = 3;

        setInterval(() => {
            for (const proc of this.processes) {
                proc.send({
                    type: ProcessMsgType.KeepAlive,
                });

                // Kill a genuinely unresponsive child. Normal room snapshots are
                // emitted every five seconds; the larger grace period also lets
                // the fault circuit breaker pause a hot room without being raced.
                // because this usually means they are frozen in an infinite loop
                if (Date.now() - proc.lastMsgTime > 45_000) {
                    const id = proc.gameData.id.substring(0, 4);
                    this.logger.warn(
                        `Process ${proc.process.pid} - #${id} did not send a message in more than 45 seconds, killing`,
                    );
                    // sigquit can dump a core of the process
                    // useful for debugging infinite loops
                    this.killProcess(proc, "SIGQUIT");
                    continue;
                }
            }

            const idleProcs = this.processes.filter(p => {
                return p.gameData.stopped && (Date.now() - p.stoppedTime) > 60000;
            });

            // kill stale processes if there's too many
            if (idleProcs.length > minIdleProcs) {
                idleProcs.sort((a, b) => a.createdTime - b.createdTime);

                const procsToKill = Math.abs(minIdleProcs - idleProcs.length);
                for (let i = 0; i < procsToKill; i++) {
                    const proc = idleProcs[i];
                    this.logger.info(`Killing ${proc.process.pid} because we have too many stale processes`);
                    this.killProcess(proc);
                }
            }
        }, 5000).unref?.();

        process.once("beforeExit", () => {
            while (this.processes.length) this.killProcess(this.processes[0]);
        });
    }

    requestForbiddenContext(
        gameId: string,
        request: {
            botPlayerId: number;
            sequence: number;
            difficulty: "forbidden" | "legit";
        },
        timeoutMs = 250,
    ): Promise<unknown | null> {
        const proc = this.processById.get(gameId);
        if (!proc || proc.gameData.stopped || !proc.process.connected) {
            return Promise.resolve(null);
        }
        const requestId = `${gameId}:${request.botPlayerId}:${request.sequence}:${randomBytes(4).toString("hex")}`;
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.pendingForbiddenContext.delete(requestId);
                resolve(null);
            }, timeoutMs);
            timer.unref?.();
            this.pendingForbiddenContext.set(requestId, { resolve, timer });
            proc.send({
                type: ProcessMsgType.ForbiddenContextRequest,
                requestId,
                ...request,
            });
        });
    }

    resolveForbiddenContext(requestId: string, payload: unknown): void {
        const pending = this.pendingForbiddenContext.get(requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pendingForbiddenContext.delete(requestId);
        pending.resolve(payload);
    }

    getPlayerCount(): number {
        return this.processes.reduce((a, b) => {
            return a + b.gameData.aliveCount;
        }, 0);
    }

    newGame(config: ServerGameConfig): GameProcess | undefined {
        let gameProc: GameProcess | undefined;

        for (let i = 0; i < this.processes.length; i++) {
            const p = this.processes[i];
            if (p.gameData.stopped) {
                gameProc = p;
                break;
            }
        }

        const id = randomBytes(20).toString("hex");
        if (!gameProc) {
            const port = this.getNextPort();
            if (port === undefined) {
                return undefined;
            }
            gameProc = new GameProcess(this, id, config, port);

            this.processes.push(gameProc);

            gameProc.process.on("exit", () => {
                this.killProcess(gameProc!);
                if (!this._freePorts.includes(gameProc!.port)) {
                    this._freePorts.push(gameProc!.port);
                }
            });

            gameProc.process.on("close", () => {
                this.killProcess(gameProc!);
            });
            gameProc.process.on("disconnect", () => {
                this.killProcess(gameProc!);
            });
            this.logger.info("Created new process with PID", gameProc.process.pid);
        } else {
            this.processById.delete(gameProc.gameData.id);
            gameProc.create(id, config);
        }

        this.processById.set(id, gameProc);

        return gameProc;
    }

    killProcess(gameProc: GameProcess, signal: NodeJS.Signals = "SIGTERM"): void {
        if (!this.processes.includes(gameProc)) return;
        // send SIGTERM, if still hasn't terminated after 5 seconds, send SIGKILL >:3
        gameProc.process.kill(signal);
        const forceKillTimer = setTimeout(() => {
            if (gameProc.process.exitCode === null) {
                gameProc.process.kill("SIGKILL");
            }
        }, 5000);
        forceKillTimer.unref?.();

        util.removeFrom(this.processes, gameProc);
        this.processById.delete(gameProc.gameData.id);
    }

    getProcessById(id: string): GameProcess | undefined {
        return this.processById.get(id);
    }

    override getById(id: string): GameData | undefined {
        const proc = this.processById.get(id);
        if (!proc) return undefined;
        return {
            ...proc.gameData,
            processHealth: proc.processHealth,
            processPid: proc.process.pid,
            lastProcessFault: proc.lastFault
                ? {
                    at: proc.lastFault.at,
                    stage: proc.lastFault.stage,
                    message: proc.lastFault.message,
                    fatal: proc.lastFault.fatal,
                    consecutive: proc.lastFault.consecutive,
                    recent: proc.lastFault.recent,
                }
                : undefined,
        };
    }

    override listGames(): GameData[] {
        return this.processes.map((proc) => this.getById(proc.gameData.id)!).filter(Boolean);
    }

    private waitUntilRunning(proc: GameProcess, timeoutMs = 15_000): Promise<GameProcess> {
        if (proc.state === ProcState.Running) return Promise.resolve(proc);
        return new Promise((resolve, reject) => {
            let settled = false;
            const onCreated = () => finish();
            const finish = (error?: Error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                proc.process.off("exit", onExit);
                util.removeFrom(proc.onCreatedCbs, onCreated);
                if (error) reject(error);
                else resolve(proc);
            };
            const onExit = () => finish(new Error("Game process exited while creating a room"));
            const timeout = setTimeout(
                () => finish(new Error("Game process did not become ready in time")),
                timeoutMs,
            );
            timeout.unref?.();
            proc.process.once("exit", onExit);
            proc.onCreatedCbs.push(onCreated);
        });
    }

    override async createGame(config: ServerGameConfig): Promise<GameData> {
        const proc = this.newGame(config);
        if (!proc) throw new Error("No game process slots are available");
        await this.waitUntilRunning(proc);
        return this.getById(proc.gameData.id)!;
    }

    override async createGameWithJoinTokens(
        config: ServerGameConfig,
        count: number,
        expiresInMs: number,
    ): Promise<FindGameResponse[]> {
        const game = await this.createGame(config);
        const joins: FindGameResponse[] = [];
        for (let index = 0; index < Math.max(0, count); index++) {
            joins.push(await this.createJoinToken(game.id, expiresInMs));
        }
        return joins;
    }

    override async createJoinToken(
        gameId: string,
        expiresInMs: number,
        spectator = false,
        playerCount = 1,
        autoFill = false,
        serverBot = false,
        serverBotTeamIds?: readonly number[],
        duelLoadoutIndex?: number,
    ): Promise<FindGameResponse> {
        const proc = this.processById.get(gameId);
        if (!proc || proc.gameData.stopped || proc.state !== ProcState.Running) {
            throw new Error("Game not found");
        }
        const token = randomBytes(20).toString("hex");
        await proc.addLegacyJoinToken(
            {
                token,
                playerCount: Math.max(1, Math.floor(playerCount)),
                expiresInMs: Math.max(1_000, Math.floor(expiresInMs)),
                spectator,
                serverBot,
                serverBotTeamIds,
                duelLoadoutIndex,
            },
            autoFill,
        );
        return {
            gameId,
            data: token,
            fill: roomFillSnapshot(proc.gameData),
        };
    }

    override revokeJoinToken(gameId: string, token: string): boolean {
        const proc = this.processById.get(gameId);
        if (!proc || proc.gameData.stopped) return false;
        proc.removeJoinToken(token);
        return true;
    }

    override stopGame(id: string): boolean {
        const proc = this.processById.get(id);
        if (!proc) return false;
        this.killProcess(proc);
        return true;
    }

    findGame(body: FindGamePrivateBody): Promise<GameProcess | undefined>;
    findGame(body: LegacyFindGameBody): Promise<FindGameResponse>;
    override async findGame(
        body: FindGamePrivateBody | LegacyFindGameBody,
    ): Promise<GameProcess | FindGameResponse | undefined> {
        if ("playerData" in body) return this.findPrivateGame(body);
        return this.findLegacyGame(body);
    }

    private async findPrivateGame(
        body: FindGamePrivateBody,
    ): Promise<GameProcess | undefined> {
        const requestedZombieDifficulty = body.zombieDifficulty;
        let proc: GameProcess | undefined = this.processes
            .filter((proc) => {
                const game = proc.gameData;
                return (
                    (game.canJoin || proc.state === ProcState.CreatingGame)
                    && hasAuthoritativeMatchmakingCapacity(
                        game.mapName,
                        proc.avaliableSlots,
                        body.playerData.length,
                    )
                    && !game.privateGame
                    && game.teamMode === body.teamMode
                    && game.mapName === body.mapName
                    && processRoomMatchesZombieDifficulty(
                        game.mapName,
                        game.zombieDifficulty,
                        requestedZombieDifficulty,
                    )
                );
            })
            .sort((a, b) => compareMatchmakingReadiness(a.gameData, b.gameData))[0];

        if (!proc) {
            const mode = {
                teamMode: body.teamMode as TeamMode,
                mapName: body.mapName as MapDefKey,
            };
            proc = this.newGame({
                ...createProcessMatchmakingGameConfig(
                    mode,
                    requestedZombieDifficulty,
                ),
            });
        }

        if (!proc) {
            return undefined;
        }

        // if the game has not finished creating
        // wait for it to be created to send the find game response
        await this.waitUntilRunning(proc);
        proc.addJoinTokens(body.playerData, body.autoFill);

        return proc;
    }

    private async findLegacyGame(body: LegacyFindGameBody): Promise<FindGameResponse> {
        const mode = Config.modes[body.gameModeIdx];
        if (!isMatchmakingPlaylistAvailable(mode, body.teamRoom)) {
            throw new Error("This matchmaking playlist is unavailable");
        }

        let proc: GameProcess | undefined = this.processes
            .filter((candidate) => {
                const game = candidate.gameData;
                return (
                    (game.canJoin || candidate.state === ProcState.CreatingGame)
                    && hasAuthoritativeMatchmakingCapacity(
                        game.mapName,
                        candidate.avaliableSlots,
                        body.playerCount,
                    )
                    && !game.privateGame
                    && game.teamMode === mode.teamMode
                    && game.mapName === mode.mapName
                    && processRoomMatchesZombieDifficulty(
                        game.mapName,
                        game.zombieDifficulty,
                        body.zombieDifficulty,
                    )
                );
            })
            .sort((a, b) => compareMatchmakingReadiness(a.gameData, b.gameData))[0];

        if (!proc) {
            proc = this.newGame(
                createProcessMatchmakingGameConfig(mode, body.zombieDifficulty),
            );
        }
        if (!proc) throw new Error("No game process slots are available");

        await this.waitUntilRunning(proc);
        const token = randomBytes(20).toString("hex");
        await proc.addLegacyJoinToken(
            {
                token,
                playerCount: Math.max(1, Math.floor(body.playerCount)),
                expiresInMs: 15_000,
                spectator: false,
                serverBot: false,
            },
            body.autoFill,
        );
        return {
            gameId: proc.gameData.id,
            data: token,
            fill: roomFillSnapshot(proc.gameData),
        };
    }

    async findGamesWithPlayer(body: SpectateGamePrivateBody): Promise<{ joinToken: string; game: GameProcess }[]> {
        const filterFn = (p: IpcGameData["livingPlayers"][0]) => {
            if (body.filter.type === "user_id") {
                return p.userId === body.filter.value;
            } else {
                return p.name === body.filter.value;
            }
        };

        const res = [];
        for (const proc of this.processes) {
            if (proc.state !== ProcState.Running) continue;

            for (const player of proc.gameData.livingPlayers) {
                if (player.disconnected) continue;
                if (!filterFn(player)) continue;

                // use slightly shorter join tokens for this...
                // since for the discord bot long URLs make the message run out of characters kinda fast
                const joinToken = randomBytes(16).toString("base64url");
                proc.addSpectateToken(joinToken, {
                    playerId: player.id,
                    specAnon: true,
                    noSpecCooldown: true,
                });

                res.push({
                    joinToken,
                    game: proc,
                });
            }
        }

        return res;
    }
}
