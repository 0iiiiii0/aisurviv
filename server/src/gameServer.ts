import { Cron } from "croner";
import { type ChildProcess, fork, spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { App, SSLApp, type TemplatedApp, type WebSocket } from "uWebSockets.js";
import pkgJson from "../../package.json" with { type: "json" };
import { isDuelMapName } from "../../shared/defs/duelMapNames.ts";
import { MapDefs } from "../../shared/defs/mapDefs.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { type AdminPureAiDuelRequest, getLiveAnnouncementSnapshot, mountAdminApi } from "./adminServer.ts";
import {
    aimTrainingCatalog,
    AimTrainingError,
    type AimTrainingSettings,
    normalizeAimTrainingSettings,
    waitForAimTrainingTarget,
} from "./aimTraining.ts";
import type { ForbiddenContextRequest, ForbiddenDifficulty } from "./bot/forbiddenCombat.ts";
import {
    completeRemoteFactionOutboundCommand,
    pollRemoteFactionOutboundCommand,
    queryRemoteFactionJobs,
    registerRemoteFactionOutboundSession,
    REMOTE_FACTION_WORKER_PROTOCOL,
    remoteBotEnvironment,
    remoteFactionGameAddress,
    remoteFactionWorkerReady,
    type RemoteFactionWorkerSettings,
    startRemoteFactionJob,
    stopRemoteFactionJob,
    unregisterRemoteFactionOutboundSession,
} from "./bot/remoteFactionWorker.ts";
import {
    getBotAutoFillPolicy,
    resolveInitialRosterDeficit,
    resolveBotAutoFillScheduleCount,
    shouldAutoFillRoom,
} from "./botAutoFill.ts";
import { Config } from "./config.ts";
import type { DuelAiDifficulty } from "./duelLoadout.ts";
import { DuelLobbyError, type DuelLobbyMatchData, type DuelLobbyMatchRequest, DuelLobbyService } from "./duelLobby.ts";
import { createPrivateDuelJoinTokens } from "./duelMatchJoinTokens.ts";
import {
    type GameData,
    getConfiguredRoomPlayerLimit,
    isAdminVisibleGame,
    isGameSpectatable,
    type MatchmakingFillInfo,
} from "./game/gameManager.ts";
import { GameProcess, GameProcessManager, ProcState } from "./game/gameProcessManager.ts";
import { SpectatorShareError, SpectatorShareService } from "./spectatorShare.ts";
import { stashManager } from "./stash/stashManager.ts";
import { apiPrivateRouter } from "./utils/apiRouter.ts";
import { GIT_VERSION } from "./utils/gitRevision.ts";
import { logErrorToWebhook, ServerLogger } from "./utils/logger.ts";
import { normalizeCpuLimits, SystemCpuMonitor } from "./utils/systemCpu.ts";
import { HTTPRateLimit, WebSocketRateLimit } from "./utils/rateLimit.ts";
import { cors, getIp, readPostedJSON, returnJson } from "./utils/serverHelpers.ts";
import {
    type FindGamePrivateBody,
    type FindGamePrivateRes,
    type SaveGameBody,
    type SpectateGamePrivateBody,
    type SpectateGamePrivateRes,
    zFindGamePrivateBody,
    zSpectateGamePrivateBody,
} from "./utils/types.ts";
import { uwsHelpers } from "./utils/uwsHelpers.ts";

process.on("uncaughtException", async (err) => {
    console.error(err);

    await logErrorToWebhook("server", "Game server error:", err);

    process.exit(1);
});

export interface AutoAiCapabilityMatchRequest {
    mapName: string;
    teamMode: TeamMode;
    botCount: number;
    difficulties?: readonly DuelAiDifficulty[];
    joinIntervalMs?: number;
    simulateHuman?: boolean;
}

interface SpawnGameBotOptions {
    gameId: string;
    token: string;
    difficulty: DuelAiDifficulty;
    difficulties?: readonly DuelAiDifficulty[];
    mapName: string;
    teamMode: TeamMode;
    gameModeIdx: number;
    adrenalineEnabled: boolean;
    botCount?: number;
    botTeamIds?: readonly number[];
    joinDelayMs?: number;
    simulatedHuman?: boolean;
}

interface RemoteFactionBotJobRef {
    jobId: string;
    gameId: string;
    token: string;
    reservedBotCount: number;
    settings: RemoteFactionWorkerSettings;
    cancelled: boolean;
    state: "starting" | "running";
    lastSeenAt: number;
    statusFailures: number;
}

export function clampExtractionReplenishBatch(
    deficit: number,
    batchCap: number,
): number {
    return Math.min(
        Math.max(1, Math.floor(deficit)),
        Math.max(1, Math.floor(batchCap)),
    );
}

export function resolveBotWorkerMaxOldSpaceMb(value: unknown): number {
    const parsed = Number(value);
    return Math.max(
        256,
        Math.min(2048, Number.isFinite(parsed) ? Math.floor(parsed) : 512),
    );
}

function resolveAutoAiCapabilityDifficulties(
    difficulties: readonly DuelAiDifficulty[] | undefined,
    botCount: number,
): DuelAiDifficulty[] {
    const pool = difficulties?.length
        ? difficulties
        : (["normal", "normal", "hard", "normal", "pro"] as const);
    return Array.from({ length: botCount }, (_, index) => pool[index % pool.length]);
}

export class GameServer {
    readonly logger = new ServerLogger("GameServer");

    readonly region = Config.regions[Config.gameServer.thisRegion];
    readonly regionId = Config.gameServer.thisRegion;

    readonly manager = new GameProcessManager();

    readonly duelLobbies = new DuelLobbyService(
        (request) => this.createPrivateDuelMatch(request),
        (gameId) => this.manager.getById(gameId),
        (gameId) => this.manager.stopGame(gameId),
    );

    readonly spectatorShares = new SpectatorShareService((gameId) => this.manager.getById(gameId));

    private readonly botProcesses = new Map<string, Set<ChildProcess>>();
    private readonly remoteFactionBotJobs = new Map<string, Map<string, RemoteFactionBotJobRef>>();
    private readonly pendingBotCount = new Map<string, { count: number; until: number }>();
    private readonly duelBotClaims = new Set<string>();
    private readonly nextBotOrdinalByGame = new Map<string, number>();
    private autoFillRunning = false;
    private readonly autoFillCpuMonitor = new SystemCpuMonitor();
    private autoFillCpuBlockedUntil = 0;
    private lastAutoFillCpuWarningAt = 0;
    private remoteFactionReconcileRunning = false;
    private nextRemoteFactionReconcileAt = 0;
    private remoteFactionWorkerUnavailableUntil = 0;
    private updateBlockUntil = 0;

    setUpdateBlock(minutes: number) {
        const duration = Math.min(10, Math.max(1, Math.floor(minutes) || 1));
        this.updateBlockUntil = Date.now() + duration * 60_000;
        return this.getUpdateBlockStatus();
    }

    clearUpdateBlock() {
        this.updateBlockUntil = 0;
        return this.getUpdateBlockStatus();
    }

    get updateBlockActive(): boolean {
        if (this.updateBlockUntil > Date.now()) return true;
        this.updateBlockUntil = 0;
        return false;
    }

    getUpdateBlockStatus() {
        const active = this.updateBlockActive;
        return {
            active,
            until: this.updateBlockUntil,
            remainingSeconds: active
                ? Math.max(1, Math.ceil((this.updateBlockUntil - Date.now()) / 1000))
                : 0,
        };
    }

    initLegacyServices(app: TemplatedApp): void {
        try {
            const recovered = stashManager.recoverPendingGrants();
            if (recovered > 0) {
                this.logger.info(`[crash-recovery] restored ${recovered} pending extraction loadouts`);
            }
        } catch (error) {
            this.logger.warn("Failed to recover pending extraction loadouts; server will continue", error);
        }

        mountAdminApi(
            app,
            this.manager,
            this.regionId,
            this.region.address,
            {
                createSpectatorMatch: (gameId) => this.createAdminSpectatorMatch(gameId),
                createPureAiDuel: (request) => this.createPureAiDuel(request),
                addAiToGame: (gameId, difficulty) => this.addAiToGame(gameId, difficulty),
                onBotAutoFillConfigChanged: () => this.pendingBotCount.clear(),
                updateBlock: {
                    set: (minutes) => this.setUpdateBlock(minutes),
                    clear: () => this.clearUpdateBlock(),
                    status: () => this.getUpdateBlockStatus(),
                },
            },
        );
        this.mountDuelLobbyApi(app);
        this.mountAimTrainingApi(app);
        this.mountSpectateApi(app);
        this.mountRemoteFactionWorkerRegistrationApi(app);

        app.get("/api/live-announcement", (res) => {
            cors(res);
            returnJson(res, getLiveAnnouncementSnapshot());
        });

        setInterval(() => void this.runBotAutoFillTick(), 1_000).unref?.();
    }

    /**
     * Lets a private 50v50 compute node register itself over Tailscale/LAN.
     * The game server learns the node address from the authenticated request,
     * so the GUI only needs the game-server address and the pre-shared key.
     */
    private mountRemoteFactionWorkerRegistrationApi(app: TemplatedApp): void {
        const pathname = "/api/remote-faction-worker/register";
        const authorize = (authorization: string): string | undefined => {
            const expected = Config.botAutoFill.remoteFactionWorker.token.trim();
            const supplied = authorization.startsWith("Bearer ")
                ? authorization.slice(7)
                : "";
            const expectedBuffer = Buffer.from(expected);
            const suppliedBuffer = Buffer.from(supplied);
            return expected.length >= 24
                    && expectedBuffer.length === suppliedBuffer.length
                    && timingSafeEqual(expectedBuffer, suppliedBuffer)
                ? expected
                : undefined;
        };
        app.options(pathname, (res) => {
            cors(res);
            res.end();
        });
        app.post(pathname, (res, req) => {
            res.onAborted(() => {
                res.aborted = true;
            });
            cors(res);

            const configured = Config.botAutoFill.remoteFactionWorker;
            const expected = authorize(req.getHeader("authorization"));
            if (!expected) {
                res.writeStatus("401 Unauthorized");
                returnJson(res, { ok: false, error: "远程密钥错误或服务器尚未设置密钥" });
                return;
            }

            const remoteAddress = getIp(res, req).replace(/^::ffff:/, "");
            readPostedJSON<{
                action?: "register" | "unregister";
                controlPort?: number;
                advertisedGameHost?: string;
                transport?: "outbound" | "callback";
                nodeId?: string;
                maxWorkers?: number;
            }>(
                res,
                async (body) => {
                    try {
                        const outbound = body.transport === "outbound";
                        const port = Math.trunc(Number(body.controlPort));
                        if (!outbound && (!Number.isInteger(port) || port < 1 || port > 65535)) {
                            throw new Error("计算节点端口无效");
                        }
                        const controlHost = remoteAddress.includes(":")
                            ? `[${remoteAddress}]`
                            : remoteAddress;
                        const controlUrl = `http://${controlHost}:${port}`;

                        if (body.action === "unregister") {
                            const outboundControlUrl = body.nodeId
                                ? `outbound://${body.nodeId}`
                                : "";
                            if (body.nodeId) unregisterRemoteFactionOutboundSession(body.nodeId);
                            if (
                                configured.controlUrl === controlUrl
                                || configured.controlUrl === outboundControlUrl
                            ) {
                                Config.botAutoFill.remoteFactionWorker = {
                                    ...configured,
                                    enabled: false,
                                };
                            }
                            if (!res.aborted) returnJson(res, { ok: true, stopped: true });
                            return;
                        }

                        const advertisedGameHost = String(body.advertisedGameHost ?? "").trim();
                        // Reuse the production address validator. It rejects loopback
                        // and malformed values before they can reach a smart-bot job.
                        remoteFactionGameAddress(
                            advertisedGameHost,
                            "",
                            Config.gameServer.firstGamePort,
                        );

                        if (outbound) {
                            const requestedNodeId = String(body.nodeId ?? "").trim();
                            const nodeId = /^[a-zA-Z0-9_-]{16,96}$/.test(requestedNodeId)
                                ? requestedNodeId.toLowerCase()
                                : randomBytes(18).toString("hex");
                            registerRemoteFactionOutboundSession(nodeId);
                            Config.botAutoFill.remoteFactionWorker = {
                                ...configured,
                                enabled: true,
                                controlUrl: `outbound://${nodeId}`,
                                advertisedGameHost,
                                token: expected,
                            };
                            this.remoteFactionWorkerUnavailableUntil = 0;
                            this.logger.info(
                                `50v50 outbound AI worker registered as ${nodeId}; game host ${advertisedGameHost}`,
                            );
                            if (!res.aborted) {
                                returnJson(res, {
                                    ok: true,
                                    transport: "outbound",
                                    nodeId,
                                    advertisedGameHost,
                                    activeWorkers: 0,
                                    maxWorkers: Math.max(1, Math.min(64, Number(body.maxWorkers) || 16)),
                                });
                            }
                            return;
                        }

                        // Do not report "connected" until the game-server side can
                        // actually reach port 9100 on the remote node.
                        const healthResponse = await fetch(`${controlUrl}/health`, {
                            signal: AbortSignal.timeout(configured.requestTimeoutMs),
                        });
                        const health = await healthResponse.json() as {
                            ok?: boolean;
                            protocolVersion?: number;
                            activeWorkers?: number;
                            maxWorkers?: number;
                        };
                        if (
                            !healthResponse.ok
                            || health.ok !== true
                            || health.protocolVersion !== REMOTE_FACTION_WORKER_PROTOCOL
                        ) {
                            throw new Error("无法验证计算节点，请检查 Tailscale 和 TCP 9100");
                        }

                        Config.botAutoFill.remoteFactionWorker = {
                            ...configured,
                            enabled: true,
                            controlUrl,
                            advertisedGameHost,
                            token: expected,
                        };
                        this.remoteFactionWorkerUnavailableUntil = 0;
                        this.logger.info(
                            `50v50 remote AI worker registered from ${controlUrl}; game host ${advertisedGameHost}`,
                        );
                        if (!res.aborted) {
                            returnJson(res, {
                                ok: true,
                                controlUrl,
                                advertisedGameHost,
                                activeWorkers: health.activeWorkers ?? 0,
                                maxWorkers: health.maxWorkers ?? 0,
                            });
                        }
                    } catch (error) {
                        if (!res.aborted) {
                            res.writeStatus("400 Bad Request");
                            returnJson(res, {
                                ok: false,
                                error: error instanceof Error ? error.message : String(error),
                            });
                        }
                    }
                },
                () => {
                    if (!res.aborted) res.writeStatus("400 Bad Request").end("Invalid JSON");
                },
            );
        });

        const pollPath = "/api/remote-faction-worker/poll";
        app.post(pollPath, (res, req) => {
            res.onAborted(() => {
                res.aborted = true;
            });
            cors(res);
            if (!authorize(req.getHeader("authorization"))) {
                res.writeStatus("401 Unauthorized");
                returnJson(res, { ok: false, error: "远程密钥错误" });
                return;
            }
            readPostedJSON<{ nodeId?: string }>(
                res,
                async (body) => {
                    try {
                        const command = await pollRemoteFactionOutboundCommand(
                            String(body.nodeId ?? ""),
                        );
                        if (!res.aborted) returnJson(res, { ok: true, command });
                    } catch (error) {
                        if (!res.aborted) {
                            res.writeStatus("409 Conflict");
                            returnJson(res, {
                                ok: false,
                                error: error instanceof Error ? error.message : String(error),
                            });
                        }
                    }
                },
                () => {
                    if (!res.aborted) res.writeStatus("400 Bad Request").end("Invalid JSON");
                },
            );
        });

        const resultPath = "/api/remote-faction-worker/result";
        app.post(resultPath, (res, req) => {
            res.onAborted(() => {
                res.aborted = true;
            });
            cors(res);
            if (!authorize(req.getHeader("authorization"))) {
                res.writeStatus("401 Unauthorized");
                returnJson(res, { ok: false, error: "远程密钥错误" });
                return;
            }
            readPostedJSON<{
                nodeId?: string;
                requestId?: string;
                ok?: boolean;
                payload?: Record<string, unknown>;
                error?: string;
            }>(
                res,
                (body) => {
                    try {
                        completeRemoteFactionOutboundCommand(
                            String(body.nodeId ?? ""),
                            String(body.requestId ?? ""),
                            { ok: body.ok === true, payload: body.payload, error: body.error },
                        );
                        if (!res.aborted) returnJson(res, { ok: true });
                    } catch (error) {
                        if (!res.aborted) {
                            res.writeStatus("409 Conflict");
                            returnJson(res, {
                                ok: false,
                                error: error instanceof Error ? error.message : String(error),
                            });
                        }
                    }
                },
                () => {
                    if (!res.aborted) res.writeStatus("400 Bad Request").end("Invalid JSON");
                },
            );
        });
    }

    getUrlsForGame(game: GameProcess) {
        const protocol = this.region.https ? "wss" : "ws";
        const mainPortUrl = new URL(`${protocol}://${this.region.address}/play`);

        const gamePortUrl = new URL(mainPortUrl.toString());
        gamePortUrl.port = game.port.toString();

        return [gamePortUrl.toString()];
    }

    private gameAddress(gameId: string, local = false): string {
        const proc = typeof this.manager.getProcessById === "function"
            ? this.manager.getProcessById(gameId)
            : undefined;
        if (!proc) return this.region.address;
        if (local) return `127.0.0.1:${proc.port}`;
        const protocol = this.region.https ? "wss" : "ws";
        const url = new URL(`${protocol}://${this.region.address}`);
        url.port = String(proc.port);
        return url.host;
    }

    private toMatchData(gameId: string, token: string): DuelLobbyMatchData {
        const address = this.gameAddress(gameId);
        return {
            zone: "",
            gameId,
            useHttps: this.region.https,
            hosts: [address],
            addrs: [address],
            data: token,
        };
    }

    async findGame(body: FindGamePrivateBody): Promise<FindGamePrivateRes> {
        if (this.updateBlockActive) return { error: "find_game_failed" };
        if (body.version !== GameConfig.protocolVersion) {
            return { error: "invalid_protocol" };
        }

        if (body.region !== this.regionId) {
            return { error: "invalid_region" };
        }
        if (
            !MapDefs[body.mapName as keyof typeof MapDefs]
            || ![TeamMode.Solo, TeamMode.Duo, TeamMode.Squad].includes(
                body.teamMode as TeamMode,
            )
            || body.playerData.length < 1
        ) {
            return { error: "find_game_failed" };
        }

        const game = await this.manager.findGame(body);
        if (!game) {
            return {
                error: "full",
            };
        }

        return {
            urls: this.getUrlsForGame(game),
        };
    }

    async findGameToSpectate(body: SpectateGamePrivateBody): Promise<SpectateGamePrivateRes> {
        const data = await this.manager.findGamesWithPlayer(body);

        return {
            players: data.map((d) => {
                return {
                    gameId: d.game.gameData.id,
                    mapName: d.game.gameData.mapName,
                    teamMode: d.game.gameData.teamMode,
                    data: {
                        joinToken: d.joinToken,
                        urls: this.getUrlsForGame(d.game),
                    },
                };
            }),
        };
    }

    private async createPrivateDuelMatch(request: DuelLobbyMatchRequest) {
        if (this.updateBlockActive) throw new Error("服务器更新中，请稍后再试");
        const { loadout, contestantLoadouts } = request;
        const joins = await createPrivateDuelJoinTokens(
            this.manager,
            {
                mapName: "duel",
                teamMode: TeamMode.Solo,
                privateGame: true,
                duelWeapons: [...loadout.weapons],
                duelPlayerLoadouts: contestantLoadouts.map((entry) => ({
                    weapons: [...entry.weapons] as [string, string],
                    ...(entry.throwables ? { throwables: { ...entry.throwables } } : {}),
                })),
                duelAdrenalineEnabled: loadout.adrenalineEnabled,
                duelBoost: loadout.adrenalineEnabled ? loadout.boost : 0,
                duelHelmetLevel: loadout.helmetLevel,
                duelChestLevel: loadout.chestLevel,
                duelScope: loadout.scope,
                duelThrowables: { ...loadout.throwables },
                duelAiEnabled: loadout.aiEnabled,
                duelAiDifficulty: loadout.aiDifficulty,
                duelDefaultLoadout: request.defaultLoadout,
            },
            loadout.aiEnabled,
            5 * 60_000,
        );

        if (loadout.aiEnabled && joins.botJoin) {
            this.duelBotClaims.add(joins.gameId);
            const spawned = this.spawnGameBot({
                gameId: joins.gameId,
                token: joins.botJoin.data,
                difficulty: loadout.aiDifficulty,
                mapName: "duel",
                teamMode: TeamMode.Solo,
                gameModeIdx: Config.modes.findIndex((mode) => mode.mapName === "duel"),
                adrenalineEnabled: loadout.adrenalineEnabled,
            });
            if (spawned === false) {
                this.manager.stopGame(joins.gameId);
                this.duelBotClaims.delete(joins.gameId);
                throw new Error("AI worker is currently unavailable");
            }
        }

        const spectatorShareCode = this.spectatorShares.create(joins.gameId);
        return {
            gameId: joins.gameId,
            matches: joins.humanJoins.map((join) => ({
                ...this.toMatchData(join.gameId, join.data),
                spectatorShareCode,
            })),
            spectatorShareCode,
        };
    }

    private async createAimTrainingMatch(settings: AimTrainingSettings) {
        if (this.updateBlockActive) throw new Error("服务器更新中，请稍后再试");
        const game = await this.manager.createGame({
            mapName: "aim_training",
            teamMode: TeamMode.Solo,
            privateGame: true,
            aimTrainingWeapon: settings.weapon0,
            aimTrainingWeapon1: settings.weapon1,
            aimTrainingThrowable: settings.throwable,
            aimTrainingInfiniteMagazine: settings.infiniteMagazine,
            aimTrainingTargetBoost: settings.targetBoost,
            aimTrainingHelmetLevel: settings.helmetLevel,
            aimTrainingChestLevel: settings.chestLevel,
            aimTrainingNormalHealth: settings.normalHealth,
            aimTrainingDistance: settings.distance,
            aimTrainingVerticalRandomMovement: settings.verticalRandomMovement,
            aimTrainingOmnidirectionalRandomMovement: settings.omnidirectionalRandomMovement,
            aimTrainingDodgeBullets: settings.dodgeBullets,
        });

        try {
            if (!(await waitForAimTrainingTarget(() => this.manager.getById(game.id), 3_000))) {
                throw new AimTrainingError("练枪标靶未能初始化，请重试");
            }
            const join = await this.manager.createJoinToken(
                game.id,
                5 * 60_000,
                false,
                1,
                false,
                false,
                undefined,
                0,
            );
            return {
                matchData: this.toMatchData(join.gameId, join.data),
                settings,
                ready: true,
            };
        } catch (error) {
            this.manager.stopGame(game.id);
            throw error;
        }
    }

    private async createPureAiDuel(request: AdminPureAiDuelRequest): Promise<{
        gameId: string;
        matchData: DuelLobbyMatchData;
        spectatorShareCode: string;
    }> {
        const loadout = request.loadout;
        const game = await this.manager.createGame({
            mapName: "duel_ai",
            teamMode: TeamMode.Solo,
            privateGame: true,
            pureAiMatch: true,
            duelWeapons: [...loadout.weapons],
            duelPlayerLoadouts: request.contestantLoadouts.map((entry) => ({
                weapons: [...entry.weapons] as [string, string],
                ...(entry.throwables ? { throwables: { ...entry.throwables } } : {}),
            })),
            duelAdrenalineEnabled: loadout.adrenalineEnabled,
            duelBoost: loadout.adrenalineEnabled ? loadout.boost : 0,
            duelHelmetLevel: loadout.helmetLevel,
            duelChestLevel: loadout.chestLevel,
            duelScope: loadout.scope,
            duelThrowables: { ...loadout.throwables },
        });
        this.duelBotClaims.add(game.id);
        try {
            const gameModeIdx = Config.modes.findIndex((mode) => mode.mapName === "duel");
            for (let index = 0; index < 2; index++) {
                const join = await this.manager.createJoinToken(
                    game.id,
                    90_000,
                    false,
                    1,
                    false,
                    true,
                    undefined,
                    index,
                );
                const spawned = this.spawnGameBot({
                    gameId: game.id,
                    token: join.data,
                    difficulty: request.difficulties[index],
                    mapName: "duel_ai",
                    teamMode: TeamMode.Solo,
                    gameModeIdx,
                    adrenalineEnabled: loadout.adrenalineEnabled,
                });
                if (spawned === false) {
                    throw new Error("AI worker is currently unavailable");
                }
            }

            const deadline = Date.now() + 12_000;
            while (Date.now() < deadline) {
                const room = this.manager.getById(game.id);
                if (!room || room.stopped || (room.serverBotCount >= 2 && room.aiPlayerCount >= 2)) break;
                await new Promise<void>((resolve) => setTimeout(resolve, 80));
            }
            const room = this.manager.getById(game.id);
            if (!room || room.stopped || room.serverBotCount < 2 || room.aiPlayerCount < 2) {
                throw new Error("两名AI未能加入1v1房间");
            }
            const spectatorShareCode = this.spectatorShares.create(game.id);
            const observer = await this.manager.createJoinToken(game.id, 5 * 60_000, true);
            return {
                gameId: game.id,
                matchData: {
                    ...this.toMatchData(observer.gameId, observer.data),
                    spectatorShareCode,
                },
                spectatorShareCode,
            };
        } catch (error) {
            this.manager.stopGame(game.id);
            this.duelBotClaims.delete(game.id);
            throw error;
        }
    }

    async createAutoAiCapabilityMatch(request: AutoAiCapabilityMatchRequest): Promise<{
        gameId: string;
        botCount: number;
        mapName: string;
        teamMode: TeamMode;
    }> {
        const { mapName, teamMode, botCount } = request;
        if (!Number.isInteger(botCount) || botCount < 2 || botCount > 60) {
            throw new Error("纯AI测试对局 botCount 需在 2-60 之间");
        }
        const mapDef = MapDefs[mapName as keyof typeof MapDefs];
        if (!mapDef) throw new Error(`找不到地图 ${mapName}`);
        if (isDuelMapName(mapName) || mapName === "aim_training") {
            throw new Error("纯AI测试对局使用标准吃鸡地图");
        }
        const gameModeIdx = Config.modes.findIndex(
            (mode) => mode.mapName === mapName && mode.teamMode === teamMode,
        );
        if (gameModeIdx < 0) throw new Error(`找不到模式配置 ${mapName}/${teamMode}`);

        const game = await this.manager.createGame({
            mapName: mapName as keyof typeof MapDefs,
            teamMode,
            privateGame: true,
            pureAiMatch: true,
        });
        const factionCount = Number(mapDef.gameMode.factions ?? 0);
        const forcedTeamIds = factionCount > 0
            ? Array.from({ length: botCount }, (_, index) => (index % factionCount) + 1)
            : [];
        const difficulties = resolveAutoAiCapabilityDifficulties(
            request.difficulties,
            botCount,
        );
        const joinIntervalMs = Math.max(
            500,
            Math.min(60_000, Math.round(request.joinIntervalMs ?? 1_000)),
        );

        try {
            for (let offset = 0; offset < botCount; offset += 8) {
                const count = Math.min(8, botCount - offset);
                const teamIds = forcedTeamIds.slice(offset, offset + count);
                const join = await this.manager.createJoinToken(
                    game.id,
                    Math.max(60_000, (count - 1) * joinIntervalMs + 30_000),
                    false,
                    count,
                    false,
                    true,
                    teamIds.length ? teamIds : undefined,
                );
                const spawned = this.spawnGameBot({
                    gameId: game.id,
                    token: join.data,
                    difficulty: difficulties[offset],
                    difficulties: difficulties.slice(offset, offset + count),
                    mapName,
                    teamMode,
                    gameModeIdx,
                    adrenalineEnabled: true,
                    botCount: count,
                    botTeamIds: teamIds,
                    joinDelayMs: joinIntervalMs,
                });
                if (spawned === false) {
                    throw new Error("AI worker is currently unavailable");
                }
            }

            if (request.simulateHuman) {
                const join = await this.manager.createJoinToken(game.id, 90_000);
                const spawned = this.spawnGameBot({
                    gameId: game.id,
                    token: join.data,
                    difficulty: difficulties[0],
                    difficulties: [difficulties[0]],
                    mapName,
                    teamMode,
                    gameModeIdx,
                    adrenalineEnabled: true,
                    simulatedHuman: true,
                });
                if (spawned === false) {
                    throw new Error("AI worker is currently unavailable");
                }
            }

            const deadline = Date.now() + 30_000;
            while (Date.now() < deadline) {
                const room = this.manager.getById(game.id);
                if (!room || room.stopped || room.serverBotCount >= botCount) break;
                await new Promise<void>((resolve) => setTimeout(resolve, 120));
            }
            const room = this.manager.getById(game.id);
            if (!room || room.stopped || room.serverBotCount < botCount) {
                throw new Error("纯AI测试对局在全部 bot 加入前提前结束");
            }
            return { gameId: game.id, botCount, mapName, teamMode };
        } catch (error) {
            this.manager.stopGame(game.id);
            throw error;
        }
    }

    private async createAdminSpectatorMatch(gameId: string): Promise<DuelLobbyMatchData> {
        const game = this.manager.getById(gameId);
        if (!game || !isGameSpectatable(game)) throw new Error("房间不存在或不可观战");
        const join = await this.manager.createJoinToken(gameId, 60_000, true);
        return this.toMatchData(join.gameId, join.data);
    }

    private async addAiToGame(gameId: string, difficulty: DuelAiDifficulty) {
        const game = this.manager.getById(gameId);
        if (!game || !isAdminVisibleGame(game) || !game.canJoin) {
            throw new Error("房间不存在或已经结束");
        }
        if (isDuelMapName(game.mapName) && this.duelBotClaims.has(gameId)) {
            throw new Error("这个1v1房间已经有 AI 对手");
        }
        const join = await this.manager.createJoinToken(
            gameId,
            90_000,
            false,
            1,
            false,
            true,
        );
        this.duelBotClaims.add(gameId);
        const spawned = this.spawnGameBot({
            gameId,
            token: join.data,
            difficulty,
            mapName: game.mapName,
            teamMode: game.teamMode,
            gameModeIdx: Config.modes.findIndex(
                (mode) => mode.mapName === game.mapName && mode.teamMode === game.teamMode,
            ),
            adrenalineEnabled: game.duelAdrenalineEnabled !== false,
        });
        if (spawned === false) {
            this.duelBotClaims.delete(gameId);
            throw new Error("AI worker is currently unavailable");
        }
        return { gameId, difficulty, mapName: game.mapName, teamMode: game.teamMode };
    }

    private activeBotWorkerCount(): number {
        let count = 0;
        for (const children of this.botProcesses.values()) count += children.size;
        for (const jobs of this.remoteFactionBotJobs.values()) {
            for (const job of jobs.values()) {
                if (!job.cancelled) count += 1;
            }
        }
        return count;
    }

    private removeRemoteFactionBotJob(job: RemoteFactionBotJobRef): void {
        const jobs = this.remoteFactionBotJobs.get(job.gameId);
        jobs?.delete(job.jobId);
        if (!jobs?.size) this.remoteFactionBotJobs.delete(job.gameId);
    }

    /**
     * Release an unfinished coordinator batch immediately. Waiting for the
     * generic pending timeout lets auto-fill launch a second full coordinator
     * while the old multi-use token is still authoritative in the room.
     */
    private releaseBotWorkerReservation(
        gameId: string,
        token: string,
        botCount: number,
    ): void {
        this.manager.revokeJoinToken(gameId, token);
        const pending = this.pendingBotCount.get(gameId);
        if (!pending) return;
        const remaining = Math.max(0, pending.count - Math.max(1, Math.floor(botCount)));
        if (remaining > 0) this.pendingBotCount.set(gameId, { ...pending, count: remaining });
        else this.pendingBotCount.delete(gameId);
    }

    private stopBotProcesses(gameId: string, reason: "room-stopped" | "room-removed"): void {
        const children = this.botProcesses.get(gameId);
        const remoteJobs = this.remoteFactionBotJobs.get(gameId);
        this.botProcesses.delete(gameId);
        this.remoteFactionBotJobs.delete(gameId);
        this.pendingBotCount.delete(gameId);
        this.duelBotClaims.delete(gameId);
        this.nextBotOrdinalByGame.delete(gameId);

        let signaled = 0;
        const localChildren = [...(children ?? [])];
        for (const child of localChildren) {
            if (child.exitCode !== null || child.signalCode !== null) continue;
            try {
                if (child.kill()) signaled += 1;
            } catch (error) {
                this.logger.warn(
                    `[bot-worker] Failed to stop worker for ${gameId.slice(0, 8)}`,
                    error,
                );
            }
        }
        if (localChildren.length > 0) {
            setTimeout(() => {
                let forced = 0;
                for (const child of localChildren) {
                    if (child.exitCode !== null || child.signalCode !== null) continue;
                    try {
                        if (child.kill("SIGKILL")) forced += 1;
                    } catch (error) {
                        this.logger.warn(
                            `[bot-worker] Failed to force-stop worker for ${gameId.slice(0, 8)}`,
                            error,
                        );
                    }
                }
                if (forced > 0) {
                    this.logger.warn(
                        `[bot-worker] Force-stopped ${forced} lingering local worker(s) for `
                            + `${gameId.slice(0, 8)} (${reason})`,
                    );
                }
            }, 2_000).unref?.();
        }
        for (const job of remoteJobs?.values() ?? []) {
            job.cancelled = true;
            void stopRemoteFactionJob(job.settings, job.jobId).catch((error) => {
                this.logger.warn(
                    `[remote-faction-worker] Failed to stop ${job.jobId}: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            });
        }
        if (children?.size || remoteJobs?.size) {
            this.logger.info(
                `[bot-worker] Requested stop for ${signaled}/${children?.size ?? 0} local and `
                    + `requested stop for `
                    + `${remoteJobs?.size ?? 0} remote worker(s) for ${gameId.slice(0, 8)} (${reason})`,
            );
        }
    }

    private spawnLocalGameBot(
        options: SpawnGameBotOptions,
        env: NodeJS.ProcessEnv,
        script: string,
        production: boolean,
        authoritativeDifficulty: ForbiddenDifficulty | undefined,
    ): boolean {
        let child: ChildProcess;
        const maxOldSpace = resolveBotWorkerMaxOldSpaceMb(
            process.env.BOT_WORKER_MAX_OLD_SPACE_MB,
        );
        const memoryArg = `--max-old-space-size=${maxOldSpace}`;
        if (authoritativeDifficulty) {
            child = fork(script, [], {
                cwd: process.cwd(),
                env,
                execArgv: production
                    ? [memoryArg, "--enable-source-maps"]
                    : [memoryArg, "--import", "tsx"],
                stdio: ["ignore", "pipe", "pipe", "ipc"],
            });
            child.on("message", (message: unknown) => {
                const request = message as Partial<ForbiddenContextRequest>;
                if (
                    request.type !== "forbidden-context-request"
                    || !Number.isInteger(request.botPlayerId)
                    || !Number.isInteger(request.sequence)
                    || (request.difficulty !== "forbidden" && request.difficulty !== "legit")
                    || !child.connected
                ) return;
                void this.manager.requestForbiddenContext(
                    options.gameId,
                    {
                        botPlayerId: Number(request.botPlayerId),
                        sequence: Number(request.sequence),
                        difficulty: request.difficulty,
                    },
                ).then((payload) => {
                    if (payload && child.connected) child.send(payload);
                });
            });
        } else {
            const args = production
                ? [memoryArg, "--enable-source-maps", script]
                : [memoryArg, "--import", "tsx", script];
            child = spawn(process.execPath, args, {
                cwd: process.cwd(),
                env,
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true,
            });
        }

        let children = this.botProcesses.get(options.gameId);
        if (!children) {
            children = new Set();
            this.botProcesses.set(options.gameId, children);
        }
        children.add(child);
        const prefix = `[bot ${options.gameId.slice(0, 8)} ${options.mapName}]`;
        child.stdout?.on("data", (chunk: Buffer) => {
            for (const line of chunk.toString().split(/\r?\n/)) {
                if (line.trim()) this.logger.info(`${prefix} ${line}`);
            }
        });
        child.stderr?.on("data", (chunk: Buffer) => {
            for (const line of chunk.toString().split(/\r?\n/)) {
                if (line.trim()) this.logger.warn(`${prefix} ${line}`);
            }
        });
        child.on("error", (error) => this.logger.warn(`${prefix} ${error.message}`));
        child.once("exit", () => {
            const active = this.botProcesses.get(options.gameId);
            active?.delete(child);
            if (!active?.size) this.botProcesses.delete(options.gameId);
            this.releaseBotWorkerReservation(
                options.gameId,
                options.token,
                options.botCount ?? 1,
            );
        });
        return true;
    }

    private dispatchRemoteFactionBot(
        options: SpawnGameBotOptions,
        env: NodeJS.ProcessEnv,
        script: string,
        production: boolean,
        settings: RemoteFactionWorkerSettings,
    ): void {
        const job: RemoteFactionBotJobRef = {
            jobId: `${options.gameId}-${randomBytes(8).toString("hex")}`,
            gameId: options.gameId,
            token: options.token,
            reservedBotCount: Math.max(1, Math.floor(options.botCount ?? 1)),
            settings: { ...settings },
            cancelled: false,
            state: "starting",
            lastSeenAt: Date.now(),
            statusFailures: 0,
        };
        let jobs = this.remoteFactionBotJobs.get(options.gameId);
        if (!jobs) {
            jobs = new Map();
            this.remoteFactionBotJobs.set(options.gameId, jobs);
        }
        jobs.set(job.jobId, job);

        void startRemoteFactionJob(settings, {
            protocolVersion: REMOTE_FACTION_WORKER_PROTOCOL,
            jobId: job.jobId,
            gameId: options.gameId,
            mapName: "faction",
            buildVersion: `${pkgJson.version}/${GIT_VERSION}`,
            environment: remoteBotEnvironment(env),
        }).then(() => {
            if (job.cancelled) {
                return stopRemoteFactionJob(settings, job.jobId).catch(() => {});
            }
            job.state = "running";
            job.lastSeenAt = Date.now();
            this.remoteFactionWorkerUnavailableUntil = 0;
            this.logger.info(
                `[remote-faction-worker] Started ${job.jobId} on ${settings.controlUrl}`,
            );
        }).catch((error) => {
            this.removeRemoteFactionBotJob(job);
            if (job.cancelled) return;
            this.remoteFactionWorkerUnavailableUntil = Date.now() + 30_000;
            this.logger.warn(
                `[remote-faction-worker] Start failed: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
            const room = this.manager.getById(options.gameId);
            if (!settings.fallbackToLocal || !room || room.stopped) {
                this.releaseBotWorkerReservation(
                    job.gameId,
                    job.token,
                    job.reservedBotCount,
                );
                return;
            }
            this.logger.info("[remote-faction-worker] Falling back to a local 50v50 worker");
            const localMatch = JSON.parse(String(env.BOT_DIRECT_MATCH_JSON)) as DuelLobbyMatchData;
            const localAddress = this.gameAddress(options.gameId, true);
            this.spawnLocalGameBot(
                options,
                {
                    ...env,
                    BOT_DIRECT_MATCH_JSON: JSON.stringify({
                        ...localMatch,
                        hosts: [localAddress],
                        addrs: [localAddress],
                    }),
                },
                script,
                production,
                undefined,
            );
        });
    }

    private async reconcileRemoteFactionBotJobs(now = Date.now()): Promise<void> {
        if (this.remoteFactionReconcileRunning || now < this.nextRemoteFactionReconcileAt) return;
        const jobs = [...this.remoteFactionBotJobs.values()].flatMap((group) => [...group.values()])
            .filter((job) => !job.cancelled && job.state === "running");
        if (!jobs.length) return;
        this.remoteFactionReconcileRunning = true;
        this.nextRemoteFactionReconcileAt = now + 5_000;
        try {
            const groups = new Map<string, RemoteFactionBotJobRef[]>();
            for (const job of jobs) {
                const key = `${job.settings.controlUrl}\n${job.settings.token}`;
                const group = groups.get(key) ?? [];
                group.push(job);
                groups.set(key, group);
            }
            for (const group of groups.values()) {
                try {
                    const statuses = await queryRemoteFactionJobs(
                        group[0].settings,
                        group.map((job) => job.jobId),
                    );
                    const byId = new Map(statuses.map((status) => [status.jobId, status]));
                    for (const job of group) {
                        const status = byId.get(job.jobId);
                        if (status?.state === "running") {
                            job.lastSeenAt = now;
                            job.statusFailures = 0;
                            continue;
                        }
                        this.removeRemoteFactionBotJob(job);
                        this.releaseBotWorkerReservation(
                            job.gameId,
                            job.token,
                            job.reservedBotCount,
                        );
                        this.remoteFactionWorkerUnavailableUntil = Date.now() + 30_000;
                        this.logger.info(
                            `[remote-faction-worker] ${job.jobId} is ${status?.state ?? "missing"}; slot released`,
                        );
                    }
                } catch (error) {
                    for (const job of group) job.statusFailures += 1;
                    if (group.some((job) => job.statusFailures === 3)) {
                        this.logger.warn(
                            `[remote-faction-worker] Status unavailable after 3 checks: ${
                                error instanceof Error ? error.message : String(error)
                            }`,
                        );
                    }
                }
            }
        } finally {
            this.remoteFactionReconcileRunning = false;
        }
    }

    private spawnGameBot(options: SpawnGameBotOptions): boolean {
        const maxWorkers = Math.max(
            1,
            Math.min(64, Math.floor(Number(Config.botAutoFill.maxBotWorkers) || 16)),
        );
        if (this.activeBotWorkerCount() >= maxWorkers) {
            this.logger.warn(`Bot worker limit reached (${maxWorkers})`);
            return false;
        }

        const botCount = Math.max(1, Math.floor(options.botCount ?? 1));
        const difficulties = Array.from(
            { length: botCount },
            (_, index) => options.difficulties?.[index] ?? options.difficulty,
        );
        const authoritativeDifficulty = difficulties.find(
            (value): value is ForbiddenDifficulty => value === "forbidden" || value === "legit",
        );
        const production = !import.meta.filename.endsWith(".ts");
        const script = path.resolve(
            import.meta.dirname,
            production ? "smartBot.js" : "smartBot.ts",
        );
        if (!existsSync(script)) {
            this.logger.warn(`Smart bot entry is missing: ${script}`);
            return false;
        }

        const settings = Config.botAutoFill.remoteFactionWorker;
        const remoteRequested = options.mapName === "faction" && settings.enabled;
        const remoteConfigured = remoteFactionWorkerReady(settings);
        let useRemote = remoteRequested
            && !authoritativeDifficulty
            && remoteConfigured
            && Date.now() >= this.remoteFactionWorkerUnavailableUntil;
        let gameAddress = this.gameAddress(options.gameId, true);
        if (useRemote) {
            try {
                const gameProcess = this.manager.getProcessById(options.gameId);
                if (!gameProcess) throw new Error("game process is missing");
                gameAddress = remoteFactionGameAddress(
                    settings.advertisedGameHost,
                    this.region.address,
                    gameProcess.port,
                );
            } catch (error) {
                useRemote = false;
                this.logger.warn(
                    `[remote-faction-worker] Invalid game address: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        }
        if (remoteRequested && !useRemote && !settings.fallbackToLocal) return false;
        if (remoteRequested && !remoteConfigured) {
            this.logger.warn(
                "[remote-faction-worker] Remote 50v50 is enabled but controlUrl/token is invalid; using local fallback",
            );
        }

        const matchData: DuelLobbyMatchData = {
            zone: "",
            gameId: options.gameId,
            data: options.token,
            useHttps: Boolean(Config.gameServer.ssl),
            hosts: [gameAddress],
            addrs: [gameAddress],
        };
        const ordinal = this.nextBotOrdinalByGame.get(options.gameId) ?? 0;
        this.nextBotOrdinalByGame.set(options.gameId, ordinal + botCount);
        const env: NodeJS.ProcessEnv = {
            ...process.env,
            BOT_DIRECT_MATCH_JSON: JSON.stringify(matchData),
            BOT_COUNT: String(botCount),
            BOT_ID_OFFSET: String(ordinal),
            BOT_JOIN_DELAY: String(Math.max(0, Math.round(options.joinDelayMs ?? 120))),
            BOT_FORCED_TEAM_IDS: JSON.stringify(options.botTeamIds ?? []),
            BOT_TEAM_SIZE: String(options.teamMode),
            BOT_GAME_MODE: String(options.gameModeIdx),
            BOT_DIFFICULTY: options.difficulty,
            BOT_DIFFICULTIES: JSON.stringify(difficulties),
            BOT_THINK_INTERVALS_MS: JSON.stringify(
                difficulties.map((difficulty) => Config.botAutoFill.thinkIntervalsMs[difficulty]),
            ),
            BOT_NAME: isDuelMapName(options.mapName) ? `AI-${options.difficulty}` : "",
            BOT_DUEL_MODE: isDuelMapName(options.mapName) ? "force" : "off",
            BOT_DUEL_ADRENALINE_POLICY: options.adrenalineEnabled
                ? "inherit"
                : "prohibited",
            BOT_MAP_AI: "1",
            BOT_EXPECTED_MAP_NAME: options.mapName,
            BOT_EXPECTED_MAP_SEED: String(
                this.manager.getProcessById(options.gameId)?.gameData?.mapSeed ?? 0,
            ),
            BOT_FACTION_AI: options.mapName === "faction" ? "1" : undefined,
            BOT_FACTION_FORCE: options.mapName === "faction" ? "1" : undefined,
            BOT_EXTRACTION_MODE: MapDefs[options.mapName as keyof typeof MapDefs]
                    ?.gameMode.extractionMode
                ? "1"
                : "0",
            BOT_EXTRACTION_SECRET: options.mapName === "extraction_secret" ? "1" : "0",
            BOT_SIMULATED_HUMAN: options.simulatedHuman ? "1" : "0",
            // Public workers automatically stretch their decision interval
            // under whole-system pressure. Explicit 0 remains an operator
            // escape hatch for isolated benchmarks.
            BOT_CPU_LIMIT_ENABLED: process.env.BOT_CPU_LIMIT_ENABLED ?? "1",
            BOT_CPU_SOFT_LIMIT: process.env.BOT_CPU_SOFT_LIMIT ?? "70",
            BOT_CPU_HARD_LIMIT: process.env.BOT_CPU_HARD_LIMIT ?? "82",
            BOT_MATCH_RECORDING: process.env.BOT_MATCH_RECORDING ?? "0",
            BOT_FORBIDDEN_CONTEXT_MS: authoritativeDifficulty ? "80" : undefined,
            TSX_TSCONFIG_PATH: path.resolve(import.meta.dirname, "../tsconfig.json"),
        };

        if (useRemote) {
            this.dispatchRemoteFactionBot(options, env, script, production, settings);
            return true;
        }
        if (remoteRequested && authoritativeDifficulty) {
            this.logger.info(
                "[remote-faction-worker] forbidden/legit still requires local IPC; using local worker",
            );
        }
        return this.spawnLocalGameBot(options, env, script, production, authoritativeDifficulty);
    }

    private async runBotAutoFillTick(): Promise<void> {
        if (this.autoFillRunning) return;
        this.autoFillRunning = true;
        try {
            const now = Date.now();
            const games = this.manager.listGames();
            const gamesById = new Map(games.map((game) => [game.id, game]));
            void this.reconcileRemoteFactionBotJobs(now);

            // Bot workers live in the game-server process rather than the room
            // process, so a stopped/removed room cannot shut them down itself.
            // Reconcile both lifecycles here before considering new auto-fill.
            const botWorkerGameIds = new Set([
                ...this.botProcesses.keys(),
                ...this.remoteFactionBotJobs.keys(),
            ]);
            for (const gameId of botWorkerGameIds) {
                const game = gamesById.get(gameId);
                if (!game) this.stopBotProcesses(gameId, "room-removed");
                else if (game.stopped) this.stopBotProcesses(gameId, "room-stopped");
            }

            const cpuPercent = this.autoFillCpuMonitor.sample();
            const cpuLimits = normalizeCpuLimits(
                Number(process.env.BOT_CPU_SOFT_LIMIT ?? 70),
                Number(process.env.BOT_CPU_HARD_LIMIT ?? 82),
            );
            if (cpuPercent >= cpuLimits.hardLimit) {
                this.autoFillCpuBlockedUntil = now + 10_000;
                if (now - this.lastAutoFillCpuWarningAt >= 10_000) {
                    this.lastAutoFillCpuWarningAt = now;
                    this.logger.warn(
                        `[bot-autofill-paused] system CPU ${cpuPercent.toFixed(1)}% >= ${cpuLimits.hardLimit}%`,
                    );
                }
            }
            const autoFillCpuBlocked = now < this.autoFillCpuBlockedUntil;

            for (const game of games) {
                if (game.stopped) {
                    this.pendingBotCount.delete(game.id);
                    continue;
                }
                if (game.privateGame || !game.canJoin) {
                    this.pendingBotCount.delete(game.id);
                    continue;
                }
                if (
                    !shouldAutoFillRoom({
                        stopped: game.stopped,
                        privateGame: game.privateGame,
                        alreadyCompleted: false,
                        humanPlayerCount: game.humanPlayerCount,
                        reservedHumanCount: game.reservedHumanCount,
                    })
                ) continue;

                const policy = getBotAutoFillPolicy(game.mapName, game.teamMode);
                if (!policy) continue;
                if (autoFillCpuBlocked) continue;
                const pending = this.pendingBotCount.get(game.id);
                const pendingCount = pending && pending.until > now ? pending.count : 0;
                if (pending && pending.until <= now) this.pendingBotCount.delete(game.id);
                const deficit = resolveInitialRosterDeficit(
                    policy.maxPlayers,
                    policy.targetPlayerCount,
                    game.contestantAdmissionCount,
                    game.reservedHumanCount,
                    pendingCount,
                    game.reservedBotCount,
                );
                if (deficit <= 0 || pendingCount > 0) continue;

                const factionCount = Number(
                    MapDefs[game.mapName as keyof typeof MapDefs]?.gameMode.factions ?? 0,
                );
                const maxBotWorkers = Math.max(
                    1,
                    Math.min(64, Math.floor(Number(Config.botAutoFill.maxBotWorkers) || 16)),
                );
                const availableWorkerSlots = Math.max(
                    0,
                    maxBotWorkers - this.activeBotWorkerCount(),
                );
                const batch = resolveBotAutoFillScheduleCount(
                    deficit,
                    policy,
                    availableWorkerSlots,
                );
                if (batch <= 0) continue;
                const plannedTeamCounts = game.serverBotTeamCounts.length
                    ? [...game.serverBotTeamCounts]
                    : Array.from({ length: factionCount }, () => 0);
                const botTeamIds = factionCount > 0
                    ? Array.from({ length: batch }, () => {
                        let best = 0;
                        for (let index = 1; index < factionCount; index++) {
                            if (
                                (plannedTeamCounts[index] ?? 0)
                                    < (plannedTeamCounts[best] ?? 0)
                            ) best = index;
                        }
                        plannedTeamCounts[best] = (plannedTeamCounts[best] ?? 0) + 1;
                        return best + 1;
                    })
                    : [];
                const joinDelayMs = policy.joinIntervalMs ?? 2_000;
                const difficulty: DuelAiDifficulty = game.mapName === "extraction_secret"
                    ? Config.extractionSecret.aiDifficulty
                    : "normal";
                const processBatchSize = clampExtractionReplenishBatch(
                    batch,
                    policy.processBatchSize ?? 8,
                );
                let spawnedCount = 0;
                for (let offset = 0; offset < batch; offset += processBatchSize) {
                    const count = Math.min(processBatchSize, batch - offset);
                    const processTeamIds = botTeamIds.slice(offset, offset + count);
                    const join = await this.manager.createJoinToken(
                        game.id,
                        120_000,
                        false,
                        count,
                        false,
                        true,
                        processTeamIds.length ? processTeamIds : undefined,
                    );
                    const spawned = this.spawnGameBot({
                        gameId: game.id,
                        token: join.data,
                        difficulty,
                        mapName: game.mapName,
                        teamMode: game.teamMode,
                        gameModeIdx: Config.modes.findIndex(
                            (mode) => mode.mapName === game.mapName
                                && mode.teamMode === game.teamMode,
                        ),
                        adrenalineEnabled: true,
                        botCount: count,
                        botTeamIds: processTeamIds,
                        joinDelayMs,
                    });
                    if (!spawned) {
                        this.manager.revokeJoinToken(game.id, join.data);
                        break;
                    }
                    spawnedCount += count;
                }
                if (spawnedCount > 0) {
                    this.pendingBotCount.set(game.id, {
                        count: spawnedCount,
                        // Parallel worker batches share the same join window;
                        // do not multiply it by the full 50v50 deficit.
                        until: now + Math.max(
                            10_000,
                            Math.min(processBatchSize, spawnedCount) * joinDelayMs + 10_000,
                        ),
                    });
                } else {
                    this.pendingBotCount.delete(game.id);
                }
            }
        } catch (error) {
            this.logger.warn("Bot auto-fill tick failed", error);
        } finally {
            this.autoFillRunning = false;
        }
    }

    private mountDuelLobbyApi(app: TemplatedApp): void {
        app.options("/api/duel-lobby", (res) => {
            cors(res);
            res.end();
        });
        const rateLimit = new HTTPRateLimit(20, 1_000);
        app.post("/api/duel-lobby", (res) => {
            res.onAborted(() => {
                res.aborted = true;
            });
            cors(res);
            if (!Config.duel.roomModeEnabled) {
                returnJson(res, { err: "1v1房间模式当前已关闭" });
                return;
            }
            if (rateLimit.isRateLimited(getIp(res))) {
                returnJson(res, { err: "操作太频繁，请稍后再试" });
                return;
            }
            readPostedJSON<Record<string, unknown>>(
                res,
                async (body) => {
                    try {
                        let result: Record<string, unknown>;
                        switch (body.action) {
                            case "create":
                                result = this.duelLobbies.create(body.name);
                                break;
                            case "join":
                                result = this.duelLobbies.join(body.code, body.name);
                                break;
                            case "status":
                                result = this.duelLobbies.status(body.code, body.memberToken);
                                break;
                            case "update":
                                result = this.duelLobbies.updateLoadout(
                                    body.code,
                                    body.memberToken,
                                    body.loadout,
                                );
                                break;
                            case "update-weapons":
                                result = this.duelLobbies.updateWeapons(
                                    body.code,
                                    body.memberToken,
                                    body.weapons,
                                );
                                break;
                            case "update-throwables":
                                result = this.duelLobbies.updateThrowables(
                                    body.code,
                                    body.memberToken,
                                    body.throwables,
                                );
                                break;
                            case "watch": {
                                const share = this.spectatorShares.resolve(body.shareCode);
                                const join = await this.manager.createJoinToken(
                                    share.gameId,
                                    60_000,
                                    true,
                                );
                                result = {
                                    matchData: {
                                        ...this.toMatchData(join.gameId, join.data),
                                        spectatorShareCode: share.code,
                                    },
                                };
                                break;
                            }
                            case "start":
                                result = await this.duelLobbies.start(
                                    body.code,
                                    body.memberToken,
                                );
                                break;
                            case "leave":
                                result = this.duelLobbies.leave(body.code, body.memberToken);
                                break;
                            default:
                                throw new DuelLobbyError("不支持的大厅操作");
                        }
                        if (!res.aborted) returnJson(res, result);
                    } catch (error) {
                        if (res.aborted) return;
                        returnJson(res, {
                            err: error instanceof DuelLobbyError
                                    || error instanceof SpectatorShareError
                                ? error.message
                                : "1v1大厅暂时不可用",
                        });
                    }
                },
                () => {},
            );
        });
    }

    private mountSpectateApi(app: TemplatedApp): void {
        const listLimit = new HTTPRateLimit(10, 1_000);
        const joinLimit = new HTTPRateLimit(5, 1_000);
        app.get("/api/spectate/rooms", (res) => {
            cors(res);
            if (listLimit.isRateLimited(getIp(res))) {
                returnJson(res, { err: "请求过于频繁，请稍后再试" });
                return;
            }
            const games = this.manager.listGames()
                .filter(isGameSpectatable)
                .map((game) => this.spectateRoomInfo(game))
                .sort((a, b) => b.startedTime - a.startedTime);
            returnJson(res, { games });
        });
        app.post("/api/spectate/join", (res) => {
            res.onAborted(() => {
                res.aborted = true;
            });
            cors(res);
            if (joinLimit.isRateLimited(getIp(res))) {
                returnJson(res, { err: "操作过于频繁，请稍后再试" });
                return;
            }
            readPostedJSON<{ gameId?: unknown }>(
                res,
                async (body) => {
                    try {
                        const gameId = typeof body.gameId === "string" ? body.gameId : "";
                        const game = this.manager.getById(gameId);
                        if (!game || !isGameSpectatable(game)) {
                            throw new Error("房间不存在或不可观战");
                        }
                        const join = await this.manager.createJoinToken(gameId, 60_000, true);
                        if (!res.aborted) {
                            returnJson(res, {
                                matchData: this.toMatchData(join.gameId, join.data),
                            });
                        }
                    } catch (error) {
                        if (!res.aborted) {
                            returnJson(res, {
                                err: error instanceof Error ? error.message : "观战请求失败",
                            });
                        }
                    }
                },
                () => {},
            );
        });
    }

    private spectateRoomInfo(game: GameData) {
        const mode = Config.modes.find(
            (candidate) =>
                candidate.mapName === game.mapName
                && candidate.teamMode === game.teamMode,
        );
        const mapDef = MapDefs[game.mapName as keyof typeof MapDefs];
        const maxPlayers = mapDef?.gameMode.factionMode
                || isDuelMapName(game.mapName)
                || game.mapName === "aim_training"
            ? Number(mapDef?.gameMode.maxPlayers ?? 80)
            : getConfiguredRoomPlayerLimit(game.teamMode);
        return {
            gameId: game.id,
            mapName: game.mapName,
            teamMode: game.teamMode,
            displayName: (mode as { title?: string } | undefined)?.title ?? game.mapName,
            maxPlayers,
            aliveCount: game.aliveCount,
            connectedCount: game.connectedCount,
            humanPlayerCount: game.humanPlayerCount,
            aiPlayerCount: game.aiPlayerCount,
            spectatorCount: game.spectatorCount,
            startedTime: game.startedTime,
        };
    }

    private mountAimTrainingApi(app: TemplatedApp): void {
        app.options("/api/aim-training", (res) => {
            cors(res);
            res.end();
        });
        const rateLimit = new HTTPRateLimit(12, 1_000);
        app.post("/api/aim-training", (res) => {
            res.onAborted(() => {
                res.aborted = true;
            });
            cors(res);
            if (rateLimit.isRateLimited(getIp(res))) {
                returnJson(res, { err: "操作太频繁，请稍后再试" });
                return;
            }
            readPostedJSON<Record<string, unknown>>(
                res,
                async (body) => {
                    try {
                        const result = body.action === "catalog"
                            ? aimTrainingCatalog()
                            : body.action === "start"
                            ? await this.createAimTrainingMatch(
                                normalizeAimTrainingSettings(body.settings),
                            )
                            : (() => {
                                throw new AimTrainingError("不支持的瞄准练习操作");
                            })();
                        if (!res.aborted) returnJson(res, result);
                    } catch (error) {
                        if (res.aborted) return;
                        returnJson(res, {
                            err: error instanceof AimTrainingError
                                ? error.message
                                : "瞄准练习暂时不可用",
                        });
                    }
                },
                () => {},
            );
        });
    }

    async sendData() {
        try {
            await apiPrivateRouter.update_region.$post({
                json: {
                    data: {
                        playerCount: this.manager.getPlayerCount(),
                    },
                    regionId: Config.gameServer.thisRegion,
                },
            });
        } catch (err) {
            this.logger.error(`Failed to update region: `, err);
        }
    }

    async tryToSaveLostGames() {
        const games: SaveGameBody["matchData"] = [];

        const dir = path.resolve("lost_game_data");

        if (!existsSync(dir)) return;

        const files = await fs.readdir(dir);

        for (const fileName of files) {
            const filePath = path.resolve(dir, fileName);
            const data = JSON.parse(await fs.readFile(filePath, "utf8"));
            games.push(...data);
        }

        if (games.length < 2) return;

        this.logger.info(`${games.length} lost games found, trying to save...`);

        let res: Response | undefined = undefined;
        try {
            res = await apiPrivateRouter.save_game.$post({
                json: {
                    matchData: games,
                },
            });
        } catch (err) {
            this.logger.error(`Failed to fetch API save game:`, err);
        }

        if (res?.ok) {
            this.logger.info(`successfully saved lost games!`);
            // if we successfully saved the games we can remove them
            for (const fileName of files) {
                const filePath = path.resolve(dir, fileName);
                await fs.rm(filePath);
            }
        }
    }
}

export function startGameServer(): void {
    const server = new GameServer();

    if (process.env.NODE_ENV !== "production") {
        server.manager.newGame(Config.modes[0]);
    }

    const app = Config.gameServer.ssl
        ? SSLApp({
            key_file_name: Config.gameServer.ssl.keyFile,
            cert_file_name: Config.gameServer.ssl.certFile,
        })
        : App();

    server.initLegacyServices(app);

    app.get("/health", (res) => {
        res.writeStatus("200 OK");
        res.write("OK");
        res.end();
    });

    app.get("/private/status", (res, req) => {
        if (req.getHeader("survev-api-key") !== Config.secrets.SURVEV_API_KEY) {
            uwsHelpers.forbidden(res);
            return;
        }

        uwsHelpers.returnJson(res, {
            gameCount: server.manager.processes.length,
            games: server.manager.processes.map(p => {
                return {
                    state: ProcState[p.state],
                    reusedCount: p.reusedCount,
                    avaliableSlots: p.avaliableSlots,
                    port: p.port,
                    processHealth: p.processHealth,
                    lastProcessFault: p.lastFault,
                    gameData: server.manager.getById(p.gameData.id),
                };
            }),
        });
    });

    app.post("/api/find_game", async (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });

        if (req.getHeader("survev-api-key") !== Config.secrets.SURVEV_API_KEY) {
            uwsHelpers.forbidden(res);
            return;
        }

        try {
            const body = await uwsHelpers.getJsonBody(res, zFindGamePrivateBody);

            uwsHelpers.returnJson(res, await server.findGame(body));
        } catch (error) {
            server.logger.warn("/api/find_game error: ", error);
            if (!res.aborted) {
                res.writeStatus("500 Internal Server Error").end("500 Internal Server Error");
            }
        }
    });

    app.post("/api/spectate_game", async (res, req) => {
        res.onAborted(() => {
            res.aborted = true;
        });

        if (req.getHeader("survev-api-key") !== Config.secrets.SURVEV_API_KEY) {
            uwsHelpers.forbidden(res);
            return;
        }

        try {
            const body = await uwsHelpers.getJsonBody(res, zSpectateGamePrivateBody);
            uwsHelpers.returnJson(res, await server.findGameToSpectate(body));
        } catch (error) {
            server.logger.warn("/api/find_game error: ", error);
            if (!res.aborted) {
                res.writeStatus("500 Internal Server Error").end("500 Internal Server Error");
            }
        }
    });

    const pingHTTPRateLimit = new HTTPRateLimit(1, 3000);
    const pingWsRateLimit = new WebSocketRateLimit(50, 1000, 10);

    interface pingSocketData {
        rateLimit: Record<symbol, number>;
        ip: string;
    }

    // ping test
    app.ws<pingSocketData>("/ptc", {
        idleTimeout: 10,
        maxPayloadLength: 2,

        upgrade(res, req, context) {
            res.onAborted((): void => {});

            const ip = uwsHelpers.getIp(res, req, Config.gameServer.proxyIPHeader);

            if (!ip) {
                server.logger.warn("Invalid IP Found:", ip);
                res.end();
                return;
            }

            if (pingHTTPRateLimit.isRateLimited(ip) || pingWsRateLimit.isIpRateLimited(ip)) {
                res.writeStatus("429 Too Many Requests");
                res.write("429 Too Many Requests");
                res.end();
                return;
            }
            pingWsRateLimit.ipConnected(ip);

            res.upgrade(
                {
                    rateLimit: {},
                    ip,
                },
                req.getHeader("sec-websocket-key"),
                req.getHeader("sec-websocket-protocol"),
                req.getHeader("sec-websocket-extensions"),
                context,
            );
        },

        message(socket: WebSocket<pingSocketData>, message) {
            if (pingWsRateLimit.isRateLimited(socket.getUserData().rateLimit)) {
                server.logger.warn("Ping websocket rate limited, closing socket.");
                socket.close();
                return;
            }
            socket.send(message, true, false);
        },

        close(ws) {
            pingWsRateLimit.ipDisconnected(ws.getUserData().ip);
        },
    });

    server.sendData();
    setInterval(() => {
        server.sendData();
    }, 20 * 1000);

    app.listen(Config.gameServer.host, Config.gameServer.port, 1, (socket) => {
        if (!socket) {
            throw new Error(`Port ${Config.gameServer.port} is already in use`);
        }
        server.logger.info(`Survev Game Server v${pkgJson.version} - GIT ${GIT_VERSION}`);
        server.logger.info(
            `Listening on ${Config.gameServer.host}:${Config.gameServer.port}`,
        );
        server.logger.info("Press Ctrl+C to exit.");
    });

    // try to save lost games every hour
    new Cron("0 * * * *", async () => {
        try {
            await server.tryToSaveLostGames();
        } catch (err) {
            server.logger.error("Failed to save lost games", err);
        }
    });
}

if ((import.meta as ImportMeta & { main?: boolean }).main) startGameServer();
