import { AchievementIds } from "../../../shared/defs/achievementDefs.ts";
import { isDuelMapName } from "../../../shared/defs/duelMapNames.ts";
import {
    EXTRACTION_MATCH_TIME_LIMIT_SECONDS,
    EXTRACTION_SECRET_JOIN_LIMIT_SECONDS,
    generateBossPoints,
    MIN_JOINABLE_REMAINING_SECONDS,
} from "../../../shared/defs/extractionDefs.ts";
import { RawGameObjectDefs as GameObjectDefs } from "../../../shared/defs/gameObjectDefs.ts";
import { PerkProperties } from "../../../shared/defs/gameObjects/perkDefs.ts";
import type { MapDefKey } from "../../../shared/defs/mapDefs.ts";
import { GameConfig, TeamMode } from "../../../shared/gameConfig.ts";
import * as net from "../../../shared/net/net.ts";
import { ObjectType } from "../../../shared/net/objectSerializeFns.ts";
import type { Loadout } from "../../../shared/utils/loadout.ts";
import { math } from "../../../shared/utils/math.ts";
import { util } from "../../../shared/utils/util.ts";
import { v2, type Vec2 } from "../../../shared/utils/v2.ts";
import { type AimTrainingSettings, normalizeAimTrainingSettings } from "../aimTraining.ts";
import { isBulletTransparentObstacleType } from "../bot/obstaclePolicy.ts";
import { Config } from "../config.ts";
import { isSecretEligibleWeapon } from "../duelWeapons.ts";
import { pickWeightedExtractionLoadout, specToGrantedLoadout } from "../extractionLoadouts.ts";
import { stashManager } from "../stash/stashManager.ts";
import { ServerLogger } from "../utils/logger.ts";
import { type FindGamePrivateBody, type ServerGameConfig } from "../utils/types.ts";
import { BossRecorder } from "./bossRecorder.ts";
import { ClientBarn } from "./client.ts";
import { ExtractionSystem } from "./extractionSystem.ts";
import { GameModeManager } from "./gameModeManager.ts";
import { Grid } from "./grid.ts";
import { GameMap } from "./map.ts";
import { AirdropBarn } from "./objects/airdrop.ts";
import { BulletBarn } from "./objects/bullet.ts";
import { DeadBodyBarn } from "./objects/deadBody.ts";
import { DecalBarn } from "./objects/decal.ts";
import { ExplosionBarn } from "./objects/explosion.ts";
import { type GameObject, ObjectRegister } from "./objects/gameObject.ts";
import { Gas } from "./objects/gas.ts";
import { LootBarn } from "./objects/loot.ts";
import { MapIndicatorBarn } from "./objects/mapIndicator.ts";
import { PlaneBarn } from "./objects/plane.ts";
import { type Player, PlayerBarn, SECRET_DROP_PERKS } from "./objects/player.ts";
import { ProjectileBarn } from "./objects/projectile.ts";
import { SmokeBarn } from "./objects/smoke.ts";
import { Profiler } from "./profiler.ts";
import { BOT_ONLY_ROOM_GRACE_MS, shouldCloseUnwatchedBotRoom } from "./roomLifecycle.ts";
import { ZombieModeSystem } from "./zombieMode.ts";

export interface JoinTokenData {
    userId: string | null;
    stashName?: string;
    findGameIp: string;
    loadout?: Loadout;
    quests?: string[];
    serverBot?: boolean;
    serverBotTeamIds?: number[];
    duelLoadoutIndex?: number;
    spectatorOnly?: boolean;
    trainingTarget?: boolean;
    groupData: {
        autoFill: boolean;
        playerCount: number;
        groupHashToJoin: string;
    };
}

export interface SpectateTokenData {
    playerId: number;
    specAnon: boolean;
    noSpecCooldown: boolean;
}

type JoinToken = {
    type: "join";
    expiresAt: number;
    /** Legacy bot/team tokens may be shared by several clients. */
    remainingUses?: number;
    data: JoinTokenData;
} | {
    type: "spectate";
    expiresAt: number;
    data: SpectateTokenData;
};

interface ArenaMatch {
    currentRound: number;
    totalRounds: number;
    resetDelay: number;
    resetTicker: number;
    transition: boolean;
    scores: Map<number, number>;
}

interface DuelDominationEvaluation {
    mapName: string;
    aiEnabled: boolean;
    aiDifficulty?: string;
    defaultLoadout: boolean;
    winnerIsBot: boolean;
    winnerAuthenticated: boolean;
    winnerScore: number;
    loserScore: number;
}

export function qualifiesForDuelDomination(
    evaluation: DuelDominationEvaluation,
): boolean {
    return (
        evaluation.mapName === "duel"
        && evaluation.aiEnabled
        && (evaluation.aiDifficulty === "legit"
            || evaluation.aiDifficulty === "forbidden")
        && evaluation.defaultLoadout
        && !evaluation.winnerIsBot
        && evaluation.winnerAuthenticated
        && evaluation.winnerScore === 5
        && evaluation.loserScore === 0
    );
}

type BossPos = { x: number; y: number; layer?: number; patrolRadius?: number };

const gameObjectDefsByType = GameObjectDefs as Readonly<
    Record<string, { type: string; maxClip?: number } | undefined>
>;

export class Game {
    started = false;

    /**
     * Contestants admitted during this match, including players that later die,
     * extract, or disconnect. Auto-fill uses this monotonic roster count so an
     * eliminated contestant is never mistaken for an empty lobby slot.
     */
    contestantAdmissionCount = 0;
    stopped = false;
    over = false;
    /** 本局是否检测到服务端引发的卡顿（帧间隔 ≥ serverLagThresholdMs）。
     *  仅用于搜打撤模式"卡顿局阵亡归还带入装备"补偿，其他模式无影响。 */
    serverLagDetected = false;
    private serverLagLastDetectedAt = 0;
    private readonly serverLagReasons = new Set<string>();
    private networkBackpressureSince = 0;
    private nextNetworkPressureCheckAt = 0;
    startedTime = 0;
    stopTicker = 0;
    timeRunning = 0;
    // used to stop the game if theres no connected players
    noPlayersTicker = 0;

    id: string;
    teamMode: TeamMode;
    mapName: MapDefKey;
    isTeamMode: boolean;
    config: ServerGameConfig;
    aimTrainingSettings: AimTrainingSettings;
    modeManager: GameModeManager;
    arenaMatch?: ArenaMatch;
    arenaRoundEpoch = 0;
    readonly arenaRoundTimeouts = new Set<NodeJS.Timeout>();
    joinTokenCleanupTicker = 0;
    disconnectCleanupTicker = 0;
    matchTimeTicker = 0;
    hadConnectedHuman = false;
    botOnlySince = 0;
    extractionSystem: ExtractionSystem | null = null;
    bossPlayers: Player[] = [];
    /** Boss 护卫（小弟）列表：跟随各自 Boss、独立索敌。 */
    bossMinions: Player[] = [];
    /** 服务器侧 Boss 录制（Boss 不在 smartBot 录制范围，独立录制供排查）。 */
    bossRecorder: BossRecorder | null = null;
    bossSpawnCounter = 0;
    bossSpawned = false;
    /** 僵尸模式系统（大批量低占用近战僵尸）。 */
    zombieMode: ZombieModeSystem | null = null;

    now!: number;
    profiler = new Profiler();
    perfTicker = 0;
    tickTimes: number[] = [];

    tickTimeWarnThreshold = (1000 / Config.gameTps) * 4;
    gameTickWarnings = 0;

    netSyncWarnThreshold = (1000 / Config.netSyncTps) * 4;
    netSyncWarnings = 0;
    netSyncTimes: number[] = [];

    joinTokens = new Map<string, JoinToken>();

    get aliveCount(): number {
        return this.playerBarn.livingPlayers.length;
    }

    grid: Grid<GameObject>;
    get duelAdrenalineEnabled(): boolean | undefined {
        return isDuelMapName(this.mapName)
            ? this.config.duelAdrenalineEnabled !== false
            : undefined;
    }

    get pureAiMatch(): boolean {
        return Boolean(this.config.pureAiMatch);
    }

    noteContestantAdmission(): void {
        this.contestantAdmissionCount += 1;
        this.updateData();
    }

    /** Authoritative zombie difficulty snapshot exposed through GameData. */
    get zombieDifficulty(): "simple" | "normal" | "hard" {
        return this.config.zombieDifficulty ?? "normal";
    }

    get trueAliveCount(): number {
        return this.playerBarn.livingPlayers.filter((p) => !p.disconnected).length;
    }

    /** Boss 与护卫是房间内原生 NPC，不属于外部 smart-bot 自动补员。 */
    private isBossNpc(player: Player): boolean {
        return player.isBoss || player.bossMinion;
    }

    /** Connected matchmaking contestants, excluding observers and native Boss NPCs. */
    get connectedCount(): number {
        return this.playerBarn.players.filter(
            (player) =>
                !player.disconnected
                && !player.spectatorOnly
                && !this.isBossNpc(player),
        ).length;
    }

    /** Connected real contestants, including dead players but excluding spectator-only clients. */
    get humanPlayerCount(): number {
        return this.playerBarn.players.filter(
            (player) =>
                !player.disconnected
                && !player.spectatorOnly
                && !player.serverBot
                && !player.extracted,
        ).length;
    }

    /** Connected server-controlled AI contestants. */
    get aiPlayerCount(): number {
        return this.playerBarn.players.filter(
            (player) =>
                !player.disconnected
                && !player.spectatorOnly
                && player.serverBot
                && !this.isBossNpc(player)
                && !player.extracted,
        ).length;
    }

    /** Connected spectator-only clients. */
    get spectatorCount(): number {
        return this.playerBarn.players.filter(
            (player) => !player.disconnected && player.spectatorOnly,
        ).length;
    }

    /** Bots launched by this server's room auto-fill controller. */
    get serverBotCount(): number {
        return this.playerBarn.players.filter(
            (player) =>
                !player.disconnected
                && !player.spectatorOnly
                && player.serverBot
                && !this.isBossNpc(player)
                && !player.extracted,
        ).length;
    }

    /** Connected real players, including dead viewers and spectator-only clients. */
    get connectedHumanCount(): number {
        return this.playerBarn.players.filter(
            (player) => !player.disconnected && !player.serverBot && !player.extracted,
        ).length;
    }

    /** Connected server bots, including a bot that has already died but not disconnected. */
    get connectedServerBotCount(): number {
        return this.playerBarn.players.filter(
            (player) => !player.disconnected && player.serverBot && !player.extracted,
        ).length;
    }

    /** 掉线但仍在重连窗口内、且未阵亡的真人（房间不应因这些真人掉线而关闭）。 */
    get pendingHumanCount(): number {
        return this.playerBarn.players.filter(
            (player) =>
                player.disconnected
                && !player.dead
                && !player.serverBot
                && !player.spectatorOnly
                && !player.extracted,
        ).length;
    }

    /** Connected auto-fill bots in each faction, indexed by teamId - 1. */
    get serverBotTeamCounts(): number[] {
        if (!this.map.factionMode) return [];
        const factionCount = Number(this.map.mapDef.gameMode.factions ?? 2);
        const counts = Array.from({ length: factionCount }, () => 0);
        for (const player of this.playerBarn.players) {
            if (
                player.disconnected
                || player.spectatorOnly
                || !player.serverBot
                || this.isBossNpc(player)
                || player.teamId < 1
                || player.teamId > factionCount
            ) {
                continue;
            }
            counts[player.teamId - 1] += 1;
        }
        return counts;
    }

    /** Unused, non-expired contestant slots reserved by normal player tokens. */
    get reservedHumanCount(): number {
        const now = Date.now();
        let count = 0;
        for (const token of this.joinTokens.values()) {
            if (
                token.type === "join"
                && !token.data.serverBot
                && !token.data.spectatorOnly
                && token.expiresAt >= now
                && token.data.groupData.playerCount > 0
            ) {
                count += token.remainingUses ?? 1;
            }
        }
        return count;
    }

    /** Unused, non-expired contestant slots reserved by smart-bot tokens. */
    get reservedBotCount(): number {
        const now = Date.now();
        let count = 0;
        for (const token of this.joinTokens.values()) {
            if (
                token.type === "join"
                && token.data.serverBot
                && !token.data.spectatorOnly
                && token.expiresAt >= now
            ) count += token.remainingUses ?? 1;
        }
        return count;
    }

    get privateGame(): boolean {
        return Boolean(this.config.privateGame);
    }

    map: GameMap;
    gas: Gas;
    objectRegister: ObjectRegister;

    clientBarn: ClientBarn;
    playerBarn: PlayerBarn;
    lootBarn: LootBarn;
    deadBodyBarn: DeadBodyBarn;
    decalBarn: DecalBarn;
    projectileBarn: ProjectileBarn;
    bulletBarn: BulletBarn;
    smokeBarn: SmokeBarn;
    airdropBarn: AirdropBarn;
    explosionBarn: ExplosionBarn;
    planeBarn: PlaneBarn;
    mapIndicatorBarn: MapIndicatorBarn;

    logger: ServerLogger;

    // for debug
    preventStart = false;
    debugSpeedMulti = 1;

    constructor(id: string, config: ServerGameConfig) {
        const start = Date.now();
        this.id = id;
        this.logger = new ServerLogger(`Game #${this.id.substring(0, 4)}`);
        this.logger.info("Creating");

        this.config = config;
        this.aimTrainingSettings = normalizeAimTrainingSettings({
            weapon0: config.aimTrainingWeapon,
            weapon1: config.aimTrainingWeapon1,
            throwable: config.aimTrainingThrowable,
            infiniteMagazine: config.aimTrainingInfiniteMagazine,
            targetBoost: config.aimTrainingTargetBoost,
            helmetLevel: config.aimTrainingHelmetLevel,
            chestLevel: config.aimTrainingChestLevel,
            normalHealth: config.aimTrainingNormalHealth,
            distance: config.aimTrainingDistance,
            verticalRandomMovement: config.aimTrainingVerticalRandomMovement,
            omnidirectionalRandomMovement: config.aimTrainingOmnidirectionalRandomMovement,
            dodgeBullets: config.aimTrainingDodgeBullets,
        });

        this.teamMode = config.teamMode;
        this.mapName = config.mapName;
        this.isTeamMode = this.teamMode !== TeamMode.Solo;

        this.map = new GameMap(this);
        const arenaRounds = this.map.mapDef.arena?.rounds;
        if (arenaRounds) {
            this.arenaMatch = {
                currentRound: 1,
                totalRounds: arenaRounds.total,
                resetDelay: arenaRounds.resetDelay,
                resetTicker: 0,
                transition: false,
                scores: new Map(),
            };
        }
        this.grid = new Grid(this.map.width, this.map.height);
        this.objectRegister = new ObjectRegister(this.grid);

        this.clientBarn = new ClientBarn(this);
        this.playerBarn = new PlayerBarn(this);
        this.lootBarn = new LootBarn(this);
        this.deadBodyBarn = new DeadBodyBarn(this);
        this.decalBarn = new DecalBarn(this);
        this.projectileBarn = new ProjectileBarn(this);
        this.bulletBarn = new BulletBarn(this);
        this.smokeBarn = new SmokeBarn(this);
        this.airdropBarn = new AirdropBarn(this);
        this.explosionBarn = new ExplosionBarn(this);
        this.planeBarn = new PlaneBarn(this);
        this.mapIndicatorBarn = new MapIndicatorBarn();

        this.gas = new Gas(this);

        this.modeManager = new GameModeManager(this);

        if (this.map.factionMode) {
            for (let i = 1; i <= this.map.mapDef.gameMode.factions!; i++) {
                this.playerBarn.addTeam(i);
            }
        }

        this.map.init();
        if (this.mapName === "aim_training") {
            this.playerBarn.spawnInternalAimTrainingTarget();
        }

        // The room config is an immutable snapshot passed by the parent process.
        // Keep custom extraction/zombie systems on top of the new synchronous
        // per-game process lifecycle.
        if (this.config.extractionBossEnabled !== undefined) {
            Config.extractionBoss.enabled = this.config.extractionBossEnabled;
        }
        this.bossRecorder = new BossRecorder();
        if (this.map.mapDef.gameMode.zombieMode) {
            this.zombieMode = new ZombieModeSystem(this);
        }
        this.spawnExtractionBosses();
        this.bossSpawned = true;
        if (this.bossRecorder.enabled && this.bossPlayers.length > 0) {
            this.bossRecorder.beginMatch(this.id);
            this.bossRecorder.recordMap(this.id, {
                mapName: this.mapName,
                width: this.map.width,
                height: this.map.height,
                bossPositions: this.bossPlayers.map((boss) => ({
                    x: boss.pos.x,
                    y: boss.pos.y,
                    layer: boss.layer,
                    patrolRadius: boss.bossPatrolRadius,
                })),
            });
            this.logger.info(
                `[boss-record] recording ${this.bossPlayers.length} boss(es) for match ${this.id}`,
            );
        }

        this.logger.info(`Created in ${Date.now() - start} ms`);

        this.updateData();
    }

    applyAimTrainingSettings(value: unknown, requestingPlayer?: Player): boolean {
        if (
            this.mapName !== "aim_training"
            || requestingPlayer?.serverBot
            || requestingPlayer?.spectatorOnly
        ) {
            return false;
        }

        const resetStats = Boolean(
            value
                && typeof value === "object"
                && (value as { resetStats?: unknown }).resetStats,
        );
        this.aimTrainingSettings = normalizeAimTrainingSettings(value);
        const human = requestingPlayer
            ?? this.playerBarn.players.find(
                (player) => !player.serverBot && !player.spectatorOnly && !player.disconnected,
            );
        const target = this.playerBarn.players.find(
            (player) => player.internalTrainingTarget && !player.disconnected,
        );

        human?.applyAimTrainingLoadout(this.aimTrainingSettings);
        if (resetStats) human?.resetTrainingStats();
        if (target) {
            target.boost = this.aimTrainingSettings.targetBoost;
            target.applyAimTrainingTargetSettings();
            target.resetInternalTrainingMovement();
            if (human) {
                target.pos.x = Math.max(
                    18,
                    Math.min(this.map.width - 18, human.pos.x + this.aimTrainingSettings.distance),
                );
                target.pos.y = Math.max(18, Math.min(this.map.height - 18, human.pos.y));
                target.setDirty();
            }
        }

        for (const player of this.playerBarn.players) {
            if (!player.serverBot && !player.spectatorOnly && !player.disconnected) {
                player.trainingStatsDirty = true;
            }
        }
        return true;
    }

    /**
     * Sandevistan world time dilation. While at least one contestant has the
     * implant active the whole match (other players, AI, bullets, gas,
     * projectiles, airdrops, map interactions) advances at worldTimeScale
     * while the caster's own actions advance at the independent
     * playerTimeScale. The dedicated mode is one human + AI fill, but
     * multiple casters are handled defensively by taking the slowest scale.
     */
    sandevistanTimeScale(): number {
        for (const player of this.playerBarn.players) {
            if (player.sandevistanActive) {
                return Config.sandevistan.worldTimeScale;
            }
        }
        return 1;
    }

    /** Caster's own action time scale (move/shoot/heal/reload), independently
     * tunable from the world/match simulation. */
    sandevistanPlayerTimeScale(): number {
        for (const player of this.playerBarn.players) {
            if (player.sandevistanActive) {
                return Config.sandevistan.playerTimeScale;
            }
        }
        return 1;
    }

    /** Records an authoritative server-side incident for extraction compensation. */
    reportServerOverload(reason: "event-loop" | "cpu" | "memory" | "network", detail: string): void {
        if (this.map.mapDef.gameMode.extractionMode !== true) return;
        this.serverLagDetected = true;
        this.serverLagLastDetectedAt = Date.now();
        if (this.serverLagReasons.has(reason)) return;
        this.serverLagReasons.add(reason);
        this.logger.warn(
            `[server-overload] ${reason}: ${detail}; extraction death refunds enabled for ${
                Config.serverLagCompensationWindowMs
            }ms`,
        );
    }

    /** Network pressure must persist; a single briefly buffered packet is normal. */
    reportNetworkBackpressure(bufferedBytes: number, dropped = false): void {
        if (this.map.mapDef.gameMode.extractionMode !== true) return;
        const now = Date.now();
        const threshold = Math.max(64 * 1024, Number(Config.serverNetworkBackpressureBytes) || 512 * 1024);
        if (dropped) {
            this.reportServerOverload("network", `websocket packet dropped with ${bufferedBytes} buffered bytes`);
            return;
        }
        if (bufferedBytes < threshold) {
            this.networkBackpressureSince = 0;
            return;
        }
        if (!this.networkBackpressureSince) this.networkBackpressureSince = now;
        const duration = now - this.networkBackpressureSince;
        if (duration >= Math.max(250, Number(Config.serverNetworkBackpressureDurationMs) || 1_500)) {
            this.reportServerOverload(
                "network",
                `${bufferedBytes} websocket bytes buffered for ${duration}ms`,
            );
        }
    }

    private sampleNetworkBackpressure(now: number): void {
        if (now < this.nextNetworkPressureCheckAt) return;
        this.nextNetworkPressureCheckAt = now + 250;
        const threshold = Math.max(64 * 1024, Number(Config.serverNetworkBackpressureBytes) || 512 * 1024);
        const openClients = this.clientBarn.clients.filter((client) => !client.socket.closed());
        const amounts = openClients.map((client) => Math.max(0, client.socket.bufferedAmount()));
        const pressured = amounts.filter((amount) => amount >= threshold);
        // Aggregate pressure across a meaningful share of the room. This avoids
        // treating one player's slow local connection as server network overload.
        const requiredClients = Math.max(1, Math.ceil(openClients.length * 0.25));
        if (pressured.length >= requiredClients) {
            this.reportNetworkBackpressure(
                pressured.reduce((total, amount) => total + amount, 0),
            );
        } else {
            this.reportNetworkBackpressure(0);
        }
    }

    serverLagCompensationActive(at = Date.now()): boolean {
        return this.serverLagDetected
            && this.serverLagLastDetectedAt > 0
            && at - this.serverLagLastDetectedAt <= Math.max(
                1_000,
                Number(Config.serverLagCompensationWindowMs) || 30_000,
            );
    }

    serverLagReasonSummary(): string {
        return [...this.serverLagReasons].join(",") || "unknown";
    }

    update(dt?: number): void {
        if (this.stopped) return;
        this.profiler.flush();

        const now = performance.now();
        const wallNow = Date.now();
        this.sampleNetworkBackpressure(wallNow);
        if (!this.now) this.now = now;
        const elapsedDt = dt ?? Math.max((now - this.now) / 1000, 0.001);
        // 服务端卡顿检测：单帧间隔 ≥ 阈值视为本局发生服务端引发的卡顿
        // （事件循环被长时间占用，玩家感知掉帧/卡死）。标记后本局搜打撤
        // 玩家阵亡（撤离失败）会归还带入装备；其他模式不产生任何影响。
        if (elapsedDt * 1000 >= Config.serverLagThresholdMs) {
            this.reportServerOverload(
                "event-loop",
                `frame interval ${(elapsedDt * 1000).toFixed(0)}ms >= ${Config.serverLagThresholdMs}ms`,
            );
        }
        dt = math.clamp(elapsedDt, 0.001, 1 / 8);
        this.now = now;
        this.timeRunning += dt;
        dt *= this.debugSpeedMulti;
        const worldDt = dt * this.sandevistanTimeScale();
        const playerDt = dt * this.sandevistanPlayerTimeScale();

        if (this.over) {
            this.stopTicker -= dt;
            if (this.stopTicker <= 0) {
                this.stop();
                return;
            }
        }

        if (!this.started && !this.preventStart) {
            this.started = this.modeManager.isGameStarted();
            if (this.started) {
                this.gas.advanceGasStage();
                if (this.arenaMatch) {
                    this.broadcastArenaRound(net.ArenaRoundState.Playing);
                }
                this.updateData();
            } else {
                const connected = this.playerBarn.players.reduce((a, b) => {
                    return a + (b.disconnected ? 0 : 1);
                }, 0);
                if (connected === 0) {
                    this.noPlayersTicker += dt;
                } else {
                    this.noPlayersTicker = 0;
                }
                // after 30 seconds of no connected players on a game that didn't start
                // we just force stop the game so it doesn't run forever...
                if (this.noPlayersTicker > 30) {
                    this.over = true;
                    this.stop();
                    return;
                }
            }
        }

        this.joinTokenCleanupTicker += dt;
        if (this.joinTokenCleanupTicker >= 1) {
            this.joinTokenCleanupTicker = 0;
            let removedExpiredToken = false;
            for (const [tokenId, token] of this.joinTokens) {
                if (
                    (token.type === "join" && (token.remainingUses ?? 1) <= 0)
                    || token.expiresAt < wallNow
                ) {
                    this.joinTokens.delete(tokenId);
                    removedExpiredToken = true;
                }
            }
            if (removedExpiredToken) this.updateData();
        }

        // Remove contestants whose socket stayed closed past the disconnect
        // timeout. Humans keep a 3-minute reconnect window (reconnectTimeout)
        // as long as they are not dead, so a refresh / IP change can resume the
        // same player. 搜打撤真人掉线不设时间上限：只要人物没彻底死、对局未结束，
        // 随时可重连（对局结束/撤离时自然清理）。Bots keep the shorter
        // disconnectTimeout so a crashed smart-bot worker releases its slot and
        // process promptly.
        this.disconnectCleanupTicker += dt;
        if (this.disconnectCleanupTicker >= 1) {
            this.disconnectCleanupTicker = 0;
            let removedDisconnected = false;
            for (const player of this.playerBarn.livingPlayers.slice()) {
                if (player.disconnected && player.disconnectAt > 0) {
                    const timeoutSeconds = player.serverBot
                        ? GameConfig.player.disconnectTimeout
                        : this.map.mapDef.gameMode.extractionMode
                        ? Number.POSITIVE_INFINITY
                        : GameConfig.player.reconnectTimeout;
                    if (wallNow - player.disconnectAt < timeoutSeconds * 1000) continue;
                    this.logger.info(
                        `"${player.name}" disconnected for over ${timeoutSeconds}s; removing from match`,
                    );
                    this.playerBarn.removePlayer(player);
                    removedDisconnected = true;
                }
            }
            if (removedDisconnected) this.updateData();
        }

        this.updateArenaMatch(dt);
        if (this.map.mapDef.gameMode.extractionMode) {
            this.extraction().update(dt);
        }
        if (this.started && !this.zombieMode?.matchTimerPaused) this.startedTime += dt;

        // 搜打撤 Boss：开局生成一次（绝密模式 + 后台开启时）。
        if (this.started && !this.bossSpawned) {
            this.bossSpawned = true;
            this.spawnExtractionBosses();
        }

        // Time-limited modes (extraction 10-min cap / zombie 6-min): push a
        // lightweight match-time sync roughly once per second for the client
        // countdown.
        if (
            this.started
            && (this.map.mapDef.gameMode.extractionMode
                || this.map.mapDef.gameMode.zombieMode)
        ) {
            this.matchTimeTicker += dt;
            if (this.matchTimeTicker >= 1) {
                this.matchTimeTicker = 0;
                const matchTimeMsg = new net.MatchTimeMsg();
                matchTimeMsg.started = true;
                matchTimeMsg.startedTime = this.startedTime;
                this.broadcastMsg(net.MsgType.MatchTime, matchTimeMsg);
            }
        }

        //
        // Update modules
        //
        this.profiler.addSample("gas");
        // Extraction and zombie maps deliberately have no shrinking gas.
        if (
            !this.map.mapDef.gameMode.extractionMode
            && !this.map.mapDef.gameMode.zombieMode
        ) {
            this.gas.update(worldDt);
        }
        this.profiler.endSample();

        this.profiler.addSample("customModes");
        this.updateBossAI(dt);
        this.updateBossMinions(dt);
        if (this.zombieMode) this.zombieMode.update(dt);
        this.profiler.endSample();

        this.profiler.addSample("players");
        this.playerBarn.update(playerDt, worldDt, dt);
        this.profiler.endSample();

        this.profiler.addSample("clients");
        this.clientBarn.update(dt);
        this.profiler.endSample();

        this.profiler.addSample("map");
        this.map.update(worldDt);
        this.profiler.endSample();

        this.profiler.addSample("loot");
        this.lootBarn.update(worldDt);
        this.profiler.endSample();

        this.profiler.addSample("bullets");
        this.bulletBarn.update(worldDt);
        this.profiler.endSample();

        this.profiler.addSample("projectiles");
        this.projectileBarn.update(worldDt);
        this.profiler.endSample();

        this.profiler.addSample("explosions");
        this.explosionBarn.update();
        this.profiler.endSample();

        this.profiler.addSample("smoke");
        this.smokeBarn.update(worldDt);
        this.profiler.endSample();

        this.profiler.addSample("airdrops");
        this.airdropBarn.update(worldDt);
        this.profiler.endSample();

        this.profiler.addSample("deadBodies");
        this.deadBodyBarn.update(worldDt);
        this.profiler.endSample();

        this.profiler.addSample("decals");
        this.decalBarn.update(worldDt);
        this.profiler.endSample();

        this.profiler.addSample("planes");
        this.planeBarn.update(worldDt);
        this.profiler.endSample();

        this.updateBotOnlyShutdown(wallNow);
        if (this.stopped) return;
        // Boss 录制：每 tick 采集一次（内部按采样间隔写帧）。
        if (this.bossRecorder?.enabled && this.bossPlayers.length > 0) {
            this.bossRecorder.tick(this as never);
        }

        const tickTime = performance.now() - this.now;

        if (tickTime > 1000) {
            let errString = `Tick took over 1 second! ${tickTime.toFixed(2)}ms\n`;
            errString += "Profiler stats:\n";
            errString += this.profiler.getStats();
            this.logger.error(errString);
        } else if (tickTime > this.tickTimeWarnThreshold) {
            this.logger.warn(
                `Tick took over ${this.tickTimeWarnThreshold}ms! ${tickTime.toFixed(2)}ms`,
            );
            this.gameTickWarnings++;

            if (this.gameTickWarnings > 20) {
                let errString = `Server is overloaded! Increasing tickTimeWarnThreshold.\n`;
                errString += "Profiler stats:\n";
                errString += this.profiler.getStats();
                this.logger.warn(errString);

                this.gameTickWarnings = 0;
                this.tickTimeWarnThreshold *= 2;
            }
        }

        if (Config.logging.debugLogs) {
            this.tickTimes.push(tickTime);

            this.perfTicker += dt;
            if (this.perfTicker >= 15) {
                this.perfTicker = 0;
                const mspt = this.tickTimes.reduce((a, b) => a + b) / this.tickTimes.length;
                const netSyncMs = this.netSyncTimes.length > 0
                    ? this.netSyncTimes.reduce((a, b) => a + b) / this.netSyncTimes.length
                    : 0;
                this.logger.debug(
                    `Avg ms/tick: ${mspt.toFixed(2)} | NetSync: ${netSyncMs.toFixed(2)}ms | Load: ${
                        ((mspt / (1000 / Config.gameTps)) * 100).toFixed(1)
                    }%`,
                );
                this.netSyncTimes = [];
                this.tickTimes = [];
            }
        }
    }

    private updateBotOnlyShutdown(now: number): void {
        const connectedHumans = this.connectedHumanCount;
        const pendingHumans = this.pendingHumanCount;
        if (connectedHumans > 0) {
            this.hadConnectedHuman = true;
            this.botOnlySince = 0;
            return;
        }

        // A player may disconnect between two game ticks. Preserve the fact
        // that this was a human-used room, but do not let its reconnect record
        // retain all bots for the full (or extraction-mode infinite) timeout.
        if (pendingHumans > 0) this.hadConnectedHuman = true;

        const shouldClose = shouldCloseUnwatchedBotRoom({
            mapName: this.mapName,
            hadConnectedHuman: this.hadConnectedHuman,
            connectedHumanCount: connectedHumans,
            disconnectedAliveHumanCount: pendingHumans,
            connectedServerBotCount: this.connectedServerBotCount,
        });
        if (!shouldClose) {
            this.botOnlySince = 0;
            return;
        }

        if (!this.botOnlySince) {
            this.botOnlySince = now;
            return;
        }
        // Allow a quick refresh/reconnect, then release every bot immediately.
        if (now - this.botOnlySince < BOT_ONLY_ROOM_GRACE_MS) return;
        this.logger.info(
            `No connected human or viewer for ${BOT_ONLY_ROOM_GRACE_MS}ms `
                + `(pending reconnect records: ${pendingHumans}, server bots: ${this.connectedServerBotCount}); `
                + "closing room and releasing bots",
        );
        this.stop();
    }

    netSync(): void {
        if (this.stopped) return;
        const start = performance.now();
        // serialize objects and send msgs
        this.objectRegister.serializeObjs();
        this.clientBarn.sendMsgs();

        //
        // reset stuff
        //
        this.clientBarn.flush();
        this.playerBarn.flush();
        this.lootBarn.flush();
        this.planeBarn.flush();
        this.bulletBarn.flush();
        this.objectRegister.flush();
        this.explosionBarn.flush();
        this.gas.flush();
        this.mapIndicatorBarn.flush();

        const syncTime = performance.now() - start;
        if (Config.logging.debugLogs) {
            this.netSyncTimes.push(syncTime);
        }
        if (syncTime > 1000) {
            this.logger.error(`Tick took over 1 second! ${syncTime.toFixed(2)}ms`);
        } else if (syncTime > this.netSyncWarnThreshold) {
            this.logger.warn(
                `Tick took over ${this.netSyncWarnThreshold}ms! ${syncTime.toFixed(2)}ms`,
            );
            this.netSyncWarnings++;

            if (this.netSyncWarnings > 20) {
                this.logger.warn(
                    `Server is overloaded! Increasing netSyncWarnThreshold.`,
                );

                this.netSyncWarnings = 0;
                this.netSyncWarnThreshold *= 2;
            }
        }
    }

    get canJoin(): boolean {
        if (this.stopped || this.over) return false;
        // 搜打撤·普通模式：AI 填充人数不是硬上限，5 分钟窗口内真人可
        // 直接追加；绝密模式保持人数上限 + 2 分钟窗口。
        const roomMax = this.roomMaxPlayers;
        if (this.map.mapDef.gameMode.extractionMode) {
            if (this.extractionSecretEnabled) {
                return this.aliveCount < roomMax && this.secretJoinableWindowOpen;
            }
            return this.joinableWindowOpen;
        }
        if (this.map.mapDef.gameMode.zombieMode || this.arenaMatch) {
            return this.aliveCount < roomMax;
        }
        return this.aliveCount < roomMax && this.gas.stage < 2 && this.startedTime < 60;
    }

    /** 房间实际人数上限：后台 roomPlayerLimits 覆盖（maxPlayersOverride），
     *  缺省回退到地图定义的上限。 */
    get roomMaxPlayers(): number {
        return this.config.maxPlayersOverride ?? this.map.mapDef.gameMode.maxPlayers;
    }

    /** 该对局还能接受新玩家加入的剩余时间（秒）。匹配时不会把玩家送进
     *  剩余时间不足 5 分钟的对局。 */
    joinableRemainingSeconds(): number {
        const limitSeconds = this.map.mapDef.gameMode.extractionMode
            ? EXTRACTION_MATCH_TIME_LIMIT_SECONDS
            : 600;
        return Math.max(0, limitSeconds - this.startedTime);
    }

    /** 剩余可加入时间是否仍满足匹配窗口（≥5 分钟）。 */
    get joinableWindowOpen(): boolean {
        return this.joinableRemainingSeconds() >= MIN_JOINABLE_REMAINING_SECONDS;
    }

    /** 绝密模式：开局 2 分钟内仍可加入（最晚 2 分钟）。 */
    get secretJoinableWindowOpen(): boolean {
        return this.startedTime <= EXTRACTION_SECRET_JOIN_LIMIT_SECONDS;
    }

    /**
     * 搜打撤真人加入门槛：普通模式 5 分钟前可直接追加；
     * 绝密模式仅开局 2 分钟内且未满员可加入。
     */
    canAcceptExtractionHuman(): boolean {
        if (!this.map.mapDef.gameMode.extractionMode) return true;
        if (this.extractionSecretEnabled) {
            return this.secretJoinableWindowOpen && this.aliveCount < this.roomMaxPlayers;
        }
        return this.joinableWindowOpen;
    }

    get arenaPlayersLocked(): boolean {
        if (!this.map.mapDef.arena?.lockPlayersUntilFull) return false;
        return !this.started || !!this.arenaMatch?.transition || this.over;
    }

    onArenaPlayerJoined(playerId: number): void {
        if (!this.arenaMatch) return;
        this.arenaMatch.scores.set(playerId, 0);
        this.broadcastArenaRound(
            this.started ? net.ArenaRoundState.Playing : net.ArenaRoundState.Waiting,
        );
    }

    scheduleArenaRoundTimeout(callback: () => void, delayMs: number): void {
        const epoch = this.arenaRoundEpoch;
        const timeout = setTimeout(() => {
            this.arenaRoundTimeouts.delete(timeout);
            if (this.stopped) return;
            if (
                this.arenaMatch
                && (epoch !== this.arenaRoundEpoch
                    || this.arenaMatch.transition
                    || this.over)
            ) {
                return;
            }
            callback();
        }, delayMs);
        this.arenaRoundTimeouts.add(timeout);
    }

    private cancelArenaRoundTimeouts(): void {
        for (const timeout of this.arenaRoundTimeouts) clearTimeout(timeout);
        this.arenaRoundTimeouts.clear();
    }

    private broadcastArenaRound(state: net.ArenaRoundState, winnerId = 0): void {
        if (!this.arenaMatch) return;
        const msg = new net.ArenaRoundMsg();
        msg.round = this.arenaMatch.currentRound;
        msg.totalRounds = this.arenaMatch.totalRounds;
        msg.state = state;
        msg.winnerId = winnerId;

        for (let i = 0; i < 2; i++) {
            const player = this.playerBarn.players[i];
            msg.playerIds[i] = player?.__id ?? 0;
            msg.scores[i] = player
                ? (this.arenaMatch.scores.get(player.__id) ?? 0)
                : 0;
        }
        this.broadcastMsg(net.MsgType.ArenaRound, msg);
    }

    handleArenaRoundDeath(victim: Player): boolean {
        const match = this.arenaMatch;
        if (!match || match.transition || this.over) return false;

        const roundWinner = this.playerBarn.players.find(
            (player) => player !== victim && !player.dead && !player.disconnected,
        );
        if (!roundWinner) return false;

        match.scores.set(
            roundWinner.__id,
            (match.scores.get(roundWinner.__id) ?? 0) + 1,
        );
        match.transition = true;

        if (match.currentRound >= match.totalRounds) {
            const contestants = this.playerBarn.players.filter((player) => !player.spectatorOnly);
            const matchWinner = contestants.reduce((best, player) =>
                (match.scores.get(player.__id) ?? 0)
                        > (match.scores.get(best.__id) ?? 0)
                    ? player
                    : best
            );
            const matchLoser = contestants.find((player) => player !== matchWinner);
            const winnerScore = match.scores.get(matchWinner.__id) ?? 0;
            const loserScore = matchLoser
                ? (match.scores.get(matchLoser.__id) ?? 0)
                : 0;

            if (
                qualifiesForDuelDomination({
                    mapName: this.mapName,
                    aiEnabled: this.config.duelAiEnabled === true,
                    aiDifficulty: this.config.duelAiDifficulty,
                    defaultLoadout: this.config.duelDefaultLoadout === true,
                    winnerIsBot: matchWinner.serverBot,
                    winnerAuthenticated: matchWinner.accountAuthenticated,
                    winnerScore,
                    loserScore,
                })
            ) {
                try {
                    const achievement = stashManager.grantAchievement(
                        matchWinner.stashName,
                        AchievementIds.DuelDomination,
                    );
                    if (achievement.awarded) {
                        const unlocked = new net.AchievementUnlockedMsg();
                        unlocked.achievementId = AchievementIds.DuelDomination;
                        matchWinner.sendMsg(net.MsgType.AchievementUnlocked, unlocked, 128);
                        this.logger.info(
                            `[achievement] ${matchWinner.stashName} unlocked duel_domination (${winnerScore}:${loserScore} vs ${this.config.duelAiDifficulty})`,
                        );
                    }
                } catch (error) {
                    this.logger.warn(
                        `[achievement] failed to award duel_domination to ${matchWinner.stashName}: ${
                            error instanceof Error ? error.message : String(error)
                        }`,
                    );
                }
            }

            this.broadcastArenaRound(net.ArenaRoundState.MatchOver, matchWinner.__id);
            for (const player of this.playerBarn.players) {
                player.addGameOverMsg(matchWinner.teamId);
            }
            this.over = true;
            this.updateData();
            setTimeout(() => this.stop(), 750);
        } else {
            match.resetTicker = match.resetDelay;
            this.broadcastArenaRound(net.ArenaRoundState.RoundOver, roundWinner.__id);
        }

        return true;
    }

    private updateArenaMatch(dt: number): void {
        const match = this.arenaMatch;
        if (!match?.transition || this.over) return;

        match.resetTicker -= dt;
        if (match.resetTicker > 0) return;

        this.cancelArenaRoundTimeouts();
        this.arenaRoundEpoch++;
        this.bulletBarn.clearForArenaRound();
        this.projectileBarn.clearForArenaRound();
        this.explosionBarn.clearForArenaRound();
        this.smokeBarn.clearForArenaRound();
        this.deadBodyBarn.clearForArenaRound();
        this.decalBarn.clearForArenaRound();
        this.planeBarn.clearForArenaRound();
        this.map.resetArenaObstacles();
        this.lootBarn.clear();
        this.gas.resetForArenaRound();

        const spawns = this.map.mapDef.arena!.playerSpawns;
        const spectators = this.playerBarn.players.filter((player) => player.spectatorOnly);
        const contestants = this.playerBarn.players.filter((player) => !player.spectatorOnly);
        this.playerBarn.livingPlayers.length = 0;
        for (let i = 0; i < contestants.length; i++) {
            const player = contestants[i];
            const spawn = v2.mulElems(
                spawns[Math.min(i, spawns.length - 1)],
                v2.create(this.map.width, this.map.height),
            );
            player.resetForArenaRound(spawn);
            if (!player.disconnected) this.playerBarn.livingPlayers.push(player);
        }
        const firstLiving = this.playerBarn.livingPlayers.find((player) => !player.disconnected);
        for (const spectator of spectators) {
            spectator.dead = true;
            spectator.health = 0;
            spectator.spectating = firstLiving;
        }

        this.playerBarn.aliveCountDirty = true;
        match.currentRound++;
        match.transition = false;
        this.broadcastArenaRound(net.ArenaRoundState.Playing);
        this.updateData();
    }

    broadcastMsg(type: net.MsgType, msg: net.Msg): void {
        this.clientBarn.broadcastMsg(type, msg);
    }

    checkGameOver(): void {
        if (this.over) return;

        const didGameEnd = this.modeManager.handleGameEnd();

        if (didGameEnd) {
            this.over = true;

            // send win emoji after 1 second
            this.playerBarn.sendWinEmoteTicker = 1;
            // stop game after 1.8s
            this.stopTicker = 1.8;

            if (
                !this.map.mapDef.gameMode.extractionMode
                && !this.map.mapDef.gameMode.zombieMode
                && this.modeManager.aliveCount() === 1
            ) {
                this.modeManager.sendGameOverMsgs();
            }
            this.updateData();
        }
    }

    addJoinTokens(tokens: FindGamePrivateBody["playerData"], autoFill: boolean) {
        const groupData = {
            playerCount: tokens.length,
            groupHashToJoin: "",
            autoFill,
        };

        for (const token of tokens) {
            this.joinTokens.set(token.joinToken, {
                type: "join",
                expiresAt: Date.now() + 10000,
                data: {
                    userId: token.userId,
                    stashName: token.stashName,
                    groupData,
                    findGameIp: token.ip,
                    loadout: token.loadout,
                    quests: token.quests,
                },
            });
        }
    }

    addSpectateToken(token: string, data: SpectateTokenData) {
        this.joinTokens.set(token, {
            type: "spectate",
            expiresAt: Date.now() + 60000,
            data,
        });
        this.updateData();
    }

    /** Compatibility token used by custom bot, duel, and spectator-only rooms. */
    addJoinToken(
        id: string,
        autoFill: boolean,
        playerCount: number,
        expiresInMs = 15000,
        spectator = false,
        serverBot = false,
        serverBotTeamIds?: readonly number[],
        duelLoadoutIndex?: number,
    ): void {
        const factionCount = Number(this.map.mapDef.gameMode.factions ?? 0);
        const normalizedServerBotTeamIds = serverBot && factionCount > 0 && serverBotTeamIds
            ? serverBotTeamIds
                .slice(0, Math.max(1, playerCount))
                .filter((teamId) => teamId >= 1 && teamId <= factionCount)
            : undefined;
        this.joinTokens.set(id, {
            type: "join",
            expiresAt: Date.now() + expiresInMs,
            remainingUses: Math.max(1, playerCount),
            data: {
                userId: null,
                findGameIp: "",
                groupData: {
                    autoFill,
                    playerCount: Math.max(1, playerCount),
                    groupHashToJoin: "",
                },
                spectatorOnly: spectator,
                serverBot,
                serverBotTeamIds: normalizedServerBotTeamIds && normalizedServerBotTeamIds.length > 0
                    ? [...normalizedServerBotTeamIds]
                    : undefined,
                duelLoadoutIndex: Number.isInteger(duelLoadoutIndex) && Number(duelLoadoutIndex) >= 0
                    ? Number(duelLoadoutIndex)
                    : undefined,
            },
        });
        this.updateData();
    }

    removeJoinToken(id: string): void {
        if (this.joinTokens.delete(id)) this.updateData();
    }

    stop(): void {
        if (this.stopped) return;
        this.stopped = true;
        // Boss 录制收尾：关闭文件流并原子改名。
        if (this.bossRecorder?.enabled) {
            this.bossRecorder.endMatch(this.id);
        }
        this.cancelArenaRoundTimeouts();
        for (const client of this.clientBarn.clients.slice()) {
            client.disconnect();
        }
        this.logger.info("Game Ended");
        this._saveGameToDatabase();
        this.updateData();
    }

    // implementation of those is on gameProcess.ts
    // this keeps the base Game class free of nodejs imports and the ability to make network requests
    // to make offline mode and unit tests easier to maintain

    updateData() {}
    protected _saveGameToDatabase() {}
    sendQuestProgress(_userId: string, _progress: Array<{ id: string; delta: number }>) {}

    /**
     * Steps the game X seconds in the future
     * This is done in smaller steps of 0.1 seconds
     * To make sure everything updates properly
     *
     * Used for unit tests, don't call this on actual game code :p
     */
    step(seconds: number) {
        for (let i = 0, steps = seconds * 10; i < steps; i++) {
            this.update(0.1);
        }
    }

    extraction(): ExtractionSystem {
        if (!this.extractionSystem) {
            this.extractionSystem = new ExtractionSystem(this);
        }
        return this.extractionSystem;
    }

    /** 搜打撤 Boss：强化的 AI 守卫（50v50 队长模型），仅在绝密搜打撤生成。 */
    spawnExtractionBosses(): void {
        if (!this.map.mapDef.gameMode.extractionMode) return;
        // 严格要求绝密地图标志：普通搜打撤即使后台误开绝密开关也不刷 Boss。
        if (!this.map.mapDef.gameMode.extractionSecretMode) return;
        if (!this.extractionSecretEnabled) return;
        if (!Config.extractionBoss.enabled) return;
        const positions = this.resolveBossPositions();
        // 护卫总数为全局配额（solo 0 / duo 2 / squad 3），平分给各 Boss。
        const minionTotal = (() => {
            const cfg = Config.extractionBoss.minions ?? { solo: 0, duo: 2, squad: 3 };
            switch (this.teamMode) {
                case TeamMode.Duo:
                    return Math.max(0, Math.min(20, Number(cfg.duo) || 0));
                case TeamMode.Squad:
                    return Math.max(0, Math.min(20, Number(cfg.squad) || 0));
                default:
                    return Math.max(0, Math.min(20, Number(cfg.solo) || 0));
            }
        })();
        const perBoss = positions.length > 0 ? Math.floor(minionTotal / positions.length) : 0;
        const extra = minionTotal - perBoss * positions.length;
        for (let i = 0; i < positions.length; i++) {
            this.spawnBossPlayer(positions[i], perBoss + (i < extra ? 1 : 0));
        }
    }

    /** 地标动态定位优先（适配多种子地图），配置坐标作为补充。 */
    resolveBossPositions(): BossPos[] {
        const desiredCount = Math.max(
            1,
            Math.min(6, Math.floor(Number(Config.extractionBoss.count) || 2)),
        );
        const positions: BossPos[] = [];
        const addPosition = (point: BossPos | null | undefined): void => {
            if (!point || positions.length >= desiredCount) return;
            const normalized: BossPos = {
                x: Math.max(8, Math.min(this.map.width - 8, Number(point.x) || 0)),
                y: Math.max(8, Math.min(this.map.height - 8, Number(point.y) || 0)),
                layer: Number(point.layer) === 1 ? 1 : 0,
                ...(point.patrolRadius === undefined
                    ? {}
                    : { patrolRadius: point.patrolRadius }),
            };
            // Do not let a configured/fallback point create two bosses on the
            // same landmark. Different gameplay layers may legitimately share
            // the same x/y coordinates.
            if (
                positions.some(
                    (existing) =>
                        (existing.layer ?? 0) === (normalized.layer ?? 0)
                        && v2.distance(existing, normalized) < 32,
                )
            ) {
                return;
            }
            positions.push(normalized);
        };

        addPosition(this.findLandmarkObj(/mansion_structure_01/));
        addPosition(this.findLandmarkObj(/bathhouse_01/));
        const configured = Config.extractionBoss.bossPositions?.[this.mapName];
        if (Array.isArray(configured) && configured.length > 0) {
            for (const point of configured) {
                addPosition(point as BossPos);
            }
        }

        // Main-map random spawns do not contain the mansion in every seed.
        // Fill any missing configured count with deterministic ground points
        // instead of silently spawning fewer bosses.
        const generated = generateBossPoints(
            this.mapName,
            this.map.width,
            this.map.height,
            desiredCount * 4,
        );
        for (const point of generated) {
            addPosition({ x: point.x, y: point.y, layer: 0 });
        }
        return positions.slice(0, desiredCount);
    }
    /** 按名称模式在地图中搜索地标对象（结构/建筑/障碍物/贴花），返回其位置和层数。 */
    findLandmarkObj(pattern: RegExp): BossPos | null {
        for (const obj of this.objectRegister.objects) {
            if (!obj) continue;

            const objType: string = (obj as any).type
                ?? (obj as any).data?.type
                ?? "";
            if (!objType || !pattern.test(objType)) continue;
            const objLayer: number = Number(
                (obj as any).layer ?? (obj as any).data?.layer ?? 0,
            );
            // 按建筑实际尺寸推巡逻半径：地标（豪宅/酒吧等）的 Boss 应覆盖
            // 整栋建筑，而不是只限出生点周围的小圈（bounds 为局部坐标，
            // 尺寸 max-min 即真实宽高）。
            let patrolRadius: number | undefined;
            const objBounds = (obj as any).bounds as
                | { min?: { x: number; y: number }; max?: { x: number; y: number } }
                | undefined;
            if (objBounds?.min && objBounds?.max) {
                const w = Math.abs(objBounds.max.x - objBounds.min.x);
                const h = Math.abs(objBounds.max.y - objBounds.min.y);
                patrolRadius = Math.max(
                    28,
                    Math.ceil(Math.max(w, h) / 2) + 10,
                );
            }
            return { x: obj.pos.x, y: obj.pos.y, layer: objLayer, patrolRadius };
        }
        return null;
    }

    /**
     * 在地标附近搜索 Boss 可站立点：验证 Player 圆形碰撞体（半径 1）
     * 不与任何可碰撞物相交，且周围 3 单位内有净空（保证出生后能巡逻走动，
     * 否则 Boss 一出生就卡在墙缝里抽搐）。
     */
    private findBossStandablePos(
        basePos: BossPos,
        playerRad: number,
    ): Vec2 | null {
        const layer = basePos.layer ?? 0;
        const maxRadius = 100;
        for (let radius = 0; radius <= maxRadius; radius += 2) {
            const samples = radius === 0 ? 1 : Math.max(10, Math.ceil((radius / 4) * 10));
            for (let s = 0; s < samples; s++) {
                const angle = (s / samples) * Math.PI * 2 + radius * 0.618;
                const pos = v2.create(
                    Math.max(2, Math.min(this.map.width - 2, basePos.x + Math.cos(angle) * radius)),
                    Math.max(2, Math.min(this.map.height - 2, basePos.y + Math.sin(angle) * radius)),
                );
                if (this.map.isOnWater(pos, layer)) continue;
                if (!this.map.isPlayerWalkableAt(pos, layer, playerRad + 0.1)) continue;
                // Require several short exits rather than treating an entire
                // building AABB as solid. This accepts real walkable interiors
                // while rejecting wall seams and one-cell traps.
                let exits = 0;
                for (let direction = 0; direction < 8; direction++) {
                    const angle = direction * Math.PI / 4;
                    const endpoint = v2.create(
                        pos.x + Math.cos(angle) * 3,
                        pos.y + Math.sin(angle) * 3,
                    );
                    if (
                        this.map.hasPlayerWalkPath(
                            pos,
                            endpoint,
                            layer,
                            playerRad + 0.05,
                        )
                    ) {
                        exits++;
                    }
                }
                if (exits < 3) continue;
                return pos;
            }
        }
        return null;
    }

    findLandmarkPos(pattern: RegExp): BossPos | null {
        return this.findLandmarkObj(pattern);
    }

    spawnBossPlayer(basePos: BossPos, minionQuota = 0): void {
        const idx = this.bossSpawnCounter++;
        const boss = this.playerBarn.addTestPlayer({
            name: "Boss",
            pos: v2.create(basePos.x, basePos.y),
        });
        boss.serverBot = true;
        boss.socketId = `boss-socket-${idx}`;

        // 在地标附近找 Player 可站立点：findSpawnableNear 只按 boss_totem
        // 碰撞体检查，会把 Boss 放进豪宅内部（被墙/柱子/书架包围 → 卡死抽搐）。
        // 这里额外验证 Player 圆形碰撞体（半径 1）不与任何可碰撞物相交。
        const pos = this.findBossStandablePos(basePos, boss.rad)
            ?? this.map.findSpawnableNear("boss_totem", basePos as Vec2, 100, basePos.layer)
            ?? { x: basePos.x, y: basePos.y };
        boss.pos.x = pos.x;
        boss.pos.y = pos.y;
        boss.layer = basePos.layer ?? 0;
        boss.aimLayer = basePos.layer ?? 0;
        boss.setDirty();

        const armorCfg = Config.extractionBoss.armor ?? {};
        if (armorCfg.helmet && gameObjectDefsByType[armorCfg.helmet]?.type === "helmet") {
            boss.helmet = armorCfg.helmet;
        } else {
            boss.helmet = "helmet04_leader";
        }
        if (armorCfg.chest && gameObjectDefsByType[armorCfg.chest]?.type === "chest") {
            boss.chest = armorCfg.chest;
        }
        if (armorCfg.backpack && gameObjectDefsByType[armorCfg.backpack]?.type === "backpack") {
            boss.backpack = armorCfg.backpack;
        }
        if (armorCfg.scope && gameObjectDefsByType[armorCfg.scope]?.type === "scope") {
            (boss.inventory as Record<string, number>)[armorCfg.scope] = 1;
            boss.scope = armorCfg.scope;
            boss.zoom = boss.scopeZoomRadius[armorCfg.scope];
        }
        boss.outfit = idx % 2 === 0 ? "outfitRedLeader" : "outfitBlueLeader";
        boss.addPerk("leadership", false);

        const weapons = Array.isArray(Config.extractionBoss.weapons)
            ? Config.extractionBoss.weapons.filter(
                (e) => e && typeof e.type === "string" && e.type.length > 0,
            )
            : [];
        if (weapons.length > 0) {
            // 初始装填：直接按武器定义的满弹夹（trueMaxClip）装填，
            // 否则 count=1 会导致 Boss 刷新时枪里只有 1 发子弹。
            // Boss 有 endless_ammo（弹药无限），弹夹决定单次连射量。
            const clipOf = (type: string): number => {
                const def = gameObjectDefsByType[type] as
                    | { type: string; maxClip?: number }
                    | undefined;
                if (def?.type === "gun" && typeof def.maxClip === "number") {
                    return def.maxClip;
                }
                return Math.max(1, Math.floor(Number(weapons[0].count) || 1));
            };
            boss.weaponManager.setWeapon(
                GameConfig.WeaponSlot.Primary,
                weapons[0].type,
                clipOf(weapons[0].type),
            );
            if (weapons.length > 1) {
                boss.weaponManager.setWeapon(
                    GameConfig.WeaponSlot.Secondary,
                    weapons[1].type,
                    clipOf(weapons[1].type),
                );
            }
            // 切换到主武器：否则 Boss 当前武器索引停留在拳头，
            // shootStart 打不出子弹（不开枪）。
            boss.weaponManager.showNextThrowable();
            boss.weaponManager.setCurWeapIndex(
                boss.weapons[0]?.type
                    ? GameConfig.WeaponSlot.Primary
                    : GameConfig.WeaponSlot.Secondary,
                true,
            );
            if (boss.weapons[0]?.type) {
                boss.weapons[0].cooldown = 0;
            }
        }

        // 基础能力（始终生效、不掉落）：后台可配置；留空回退默认 3 个。
        // 过滤用 GameObjectDefs（全部能力，含 firepower 等纯标记能力），
        // 不能用 PerkProperties（只含带属性效果的子集，会漏掉很多能力）。
        const isPerkType = (p: string) => typeof p === "string" && gameObjectDefsByType[p]?.type === "perk";
        const basePerks = Array.isArray(Config.extractionBoss.bossDefaultPerks)
            ? Config.extractionBoss.bossDefaultPerks.filter(isPerkType)
            : [];
        const effectiveBasePerks = basePerks.length > 0
            ? basePerks
            : ["steelskin", "flak_jacket", "gotw"];
        for (const perk of effectiveBasePerks) {
            if (!boss.hasPerk(perk)) boss.addPerk(perk, false);
        }

        // 掉落能力：像正常 AI 一样随机选一个佩戴（死亡必掉）。
        // 后台可配置能力池（bossPerks）；留空 = 从 SECRET_DROP_PERKS 全池随机。
        const pool = Array.isArray(Config.extractionBoss.bossPerks)
            ? Config.extractionBoss.bossPerks.filter(isPerkType)
            : [];
        const dropPool = pool.length > 0
            ? pool
            : SECRET_DROP_PERKS.filter(isPerkType);
        const wornPerk = dropPool.length > 0
            ? dropPool[Math.floor(Math.random() * dropPool.length)]
            : "";
        if (wornPerk && !boss.hasPerk(wornPerk)) boss.addPerk(wornPerk, false);
        boss.bossWornPerk = wornPerk;

        boss.isBoss = true;
        boss.bossHealthBuffer = Math.max(0, Math.floor(Number(Config.extractionBoss.maxHealth) || 600));
        boss.bossDropItems = Array.isArray(Config.extractionBoss.dropItems)
            ? Config.extractionBoss.dropItems
                .filter((e) => e && typeof e.type === "string")
                .map((e) => ({
                    type: e.type,
                    count: Math.max(1, Math.floor(Number(e.count) || 1)),
                    weight: Math.max(0, Math.min(100, Number(e.weight) || 0)),
                }))
            : [];
        boss.bossWeaponsList = weapons.map((e) => ({
            type: e.type,
            count: Math.max(1, Math.floor(Number(e.count) || 1)),
        }));

        if (!boss.hasPerk("endless_ammo")) boss.addPerk("endless_ammo", false);

        // Boss 巡逻系统
        boss.bossPatrolCenter = v2.create(boss.pos.x, boss.pos.y);
        // 地标 Boss 按建筑尺寸扩巡逻半径（覆盖整栋建筑）；
        // 配置位置/回退生成仍用全局 patrolRadius。
        boss.bossPatrolRadius = Math.max(
            8,
            Math.floor(
                Number(basePos.patrolRadius ?? Config.extractionBoss.patrolRadius) || 24,
            ),
        );
        boss.bossPatrolTarget = v2.copy(boss.pos);
        boss.bossPatrolTimer = 0;
        boss.bossTarget = null;
        boss.bossReturnTimer = 0;
        boss.bossSpeedMultiplier = 1;
        boss.bossNextShotAt = 0;
        boss.bossLastStuckPos = v2.copy(boss.pos);
        boss.bossStuckSince = Date.now();
        boss.bossUnstuckDir = v2.create(1, 0);
        boss.bossUnstuckUntil = 0;
        boss.bossStuckCount = 0;
        boss.bossStationaryUntil = 0;
        boss.bossNoLosSince = 0;
        boss.bossTargetNoLosUntil = 0;
        boss.bossNoLosTargetId = 0;
        boss.bossRetreating = false;
        boss.bossHitChaseUntil = 0;
        boss.bossRangeUnlocked = false;
        boss.bossFlankSign = Math.random() < 0.5 ? -1 : 1;
        boss.bossFlankNextAt = 0;

        // 满激素
        boss.boost = 100;
        // 体型兜底：无论 addPerk/能力发放时序如何，Boss 最终保持普通玩家体型
        // （recalculateScale 的 isBoss 分支固定 scale=1）。
        boss.recalculateScale();

        // Boss 护卫（小弟）：按对局人数配置的全局总数由 spawnExtractionBosses
        // 平分到各 Boss；本 Boss 分得 minionQuota 个，在附近刷新。
        for (let m = 0; m < minionQuota; m++) {
            const minion = this.spawnBossMinion(boss, m);
            if (minion) this.bossMinions.push(minion);
        }

        this.bossPlayers.push(boss);
        this.logger.info(
            `[boss] spawned at (${boss.pos.x.toFixed(0)},${
                boss.pos.y.toFixed(0)
            }) layer=${boss.layer} patrolR=${boss.bossPatrolRadius}`,
        );
    }

    /** 生成一个 Boss 护卫（小弟）：在 Boss 附近刷普通搜打撤 AI，
     *  配装自动发放（preset），额外佩戴不掉落的子弹分裂（splinter）。 */
    private spawnBossMinion(boss: Player, index: number): Player | null {
        try {
            const minion = this.playerBarn.addTestPlayer({
                name: `BossGuard${boss.__id}-${index + 1}`,
                pos: v2.copy(boss.pos),
            });
            minion.serverBot = true;
            minion.socketId = `boss-minion-socket-${this.id}-${boss.__id}-${index}`;
            const pos = this.map.findSpawnableNear(
                "boss_totem",
                v2.add(
                    boss.pos,
                    v2.create(
                        (index % 2 === 0 ? 1 : -1) * (4 + index),
                        (index % 2 === 0 ? 1 : -1) * 3,
                    ),
                ),
                60,
                boss.layer,
            ) ?? { x: boss.pos.x, y: boss.pos.y };
            minion.pos.x = pos.x;
            minion.pos.y = pos.y;
            minion.layer = boss.layer;
            minion.aimLayer = boss.layer;
            minion.setDirty();
            minion.bossMinion = true;
            // 配装自动发放（普通搜打撤 AI preset）+ 无限弹药
            this.applyExtractionSpawnLoadout(minion);
            // 子弹分裂 buff：真实生效、不掉落（droppable=false）。
            if (!minion.hasPerk("splinter")) minion.addPerk("splinter", false);
            this.logger.info(
                `[boss] minion spawned for Boss at (${minion.pos.x.toFixed(0)},${
                    minion.pos.y.toFixed(0)
                }) layer=${minion.layer}`,
            );
            return minion;
        } catch (error) {
            this.logger.warn(
                `[boss] failed to spawn minion: ${error instanceof Error ? error.message : String(error)}`,
            );
            return null;
        }
    }

    /** Boss 护卫（小弟）AI：独立索敌最近可见玩家攻击；无目标时跟随 Boss
     *  保持护卫圈（过远回位、过近散开）。与 Boss 一样受 LOS/楼层限制。 */
    updateBossMinions(dt: number): void {
        if (this.bossMinions.length === 0) return;
        const now = Date.now();
        const liveMinions = this.bossMinions.filter(
            (m) => !m.dead && !m.disconnected,
        );
        for (const minion of liveMinions) {
            const owner = this.bossPlayers.find(
                (b) =>
                    !b.dead
                    && !b.disconnected
                    && v2.distance(b.pos, minion.pos) < 120,
            );
            let moveDir: { x: number; y: number } | null = null;
            let shouldShoot = false;
            let aimTarget: Player | null = null;

            // 1) 独立索敌：最近的可见真人（同层 + LOS + 射程 45）
            let bestEnemy: Player | null = null;
            let bestDist = Infinity;
            for (const p of this.playerBarn.players) {
                if (
                    p === minion
                    || p.dead
                    || p.spectatorOnly
                    || p.disconnected
                    || p.serverBot
                    || p.bossMinion
                    || !util.sameLayer(minion.layer, p.layer)
                ) {
                    continue;
                }
                const d = v2.distance(minion.pos, p.pos);
                if (d > 45 || d >= bestDist) continue;
                if (!this.bossHasClearShot(minion.pos, p.pos, minion.layer)) {
                    continue;
                }
                bestDist = d;
                bestEnemy = p;
            }
            if (bestEnemy) {
                aimTarget = bestEnemy;
                const d = v2.distance(minion.pos, bestEnemy.pos);
                if (d > 24) {
                    moveDir = v2.normalize(
                        v2.sub(bestEnemy.pos, minion.pos),
                    );
                } else if (d < 10) {
                    moveDir = v2.normalize(
                        v2.sub(minion.pos, bestEnemy.pos),
                    );
                }
                shouldShoot = d <= 45;
            }

            // 2) 跟随 Boss：无目标时保持护卫圈（10-24 距离）
            if (!bestEnemy && owner) {
                const d = v2.distance(minion.pos, owner.pos);
                if (d > 24) {
                    moveDir = v2.normalize(v2.sub(owner.pos, minion.pos));
                } else if (d < 8) {
                    moveDir = v2.normalize(v2.sub(minion.pos, owner.pos));
                }
            }

            if (moveDir) {
                minion.moveLeft = moveDir.x < -0.2;
                minion.moveRight = moveDir.x > 0.2;
                minion.moveUp = moveDir.y > 0.2;
                minion.moveDown = moveDir.y < -0.2;
                minion.dir = v2.create(moveDir.x, moveDir.y);
            } else {
                minion.moveLeft = false;
                minion.moveRight = false;
                minion.moveUp = false;
                minion.moveDown = false;
            }
            minion.shootStart = shouldShoot;
            minion.shootHold = shouldShoot;
            if (aimTarget) {
                minion.dir = v2.normalize(
                    v2.sub(aimTarget.pos, minion.pos),
                );
            }
            // 与 Boss 同理：同步 dirNew，防止 AI 朝向被玩家 update() 的
            // dir=dirNew 逻辑重置回默认 (1,0)。
            minion.dirNew = v2.copy(minion.dir);
            minion.setDirty();
        }
        this.bossMinions = liveMinions;
    }

    /** Boss AI：未受伤时守住巡逻区；绝密 Boss 受伤后解除范围限制。 */
    updateBossAI(dt: number): void {
        if (this.bossPlayers.length === 0) return;
        const now = Date.now();
        for (const boss of this.bossPlayers) {
            if (boss.dead || boss.disconnected || !boss.weapons[GameConfig.WeaponSlot.Primary]?.type) {
                continue;
            }
            const center = boss.bossPatrolCenter;
            const radius = boss.bossPatrolRadius;
            const rangeUnlocked = boss.bossRangeUnlocked;
            const attackRange = 32;
            const chaseRange = 48;
            // 到达阈值：小于该距离停止移动，防止在目标点附近来回振荡（抽搐）。
            const arrival = 0.9;
            // These fields are sampled by the boss recorder. Reset them before this
            // tick's targeting pass so a lost target does not leave stale LOS/range.
            boss.bossHasLosNow = false;
            boss.bossTargetDist = 0;

            // 只在上一周期确实下达过移动指令时检测卡墙。巡逻到点后的
            // patrol-wait 本来就应当不动，旧逻辑却会把它误判为卡墙，形成
            // “强制站桩 5 秒 -> 逃逸 -> 再站桩”的循环。
            const movementWasRequested = Math.hypot(boss.bossMoveDir.x, boss.bossMoveDir.y) > 0.2;
            if (!movementWasRequested) {
                boss.bossLastStuckPos = v2.copy(boss.pos);
                boss.bossStuckSince = now;
                boss.bossStuckCount = 0;
            } else if (now - boss.bossStuckSince >= 1000) {
                const movedInSecond = v2.distance(boss.pos, boss.bossLastStuckPos);
                boss.bossLastStuckPos = v2.copy(boss.pos);
                boss.bossStuckSince = now;
                if (movedInSecond < 1.0) {
                    boss.bossStuckCount += 1;
                    const detectedCount = boss.bossStuckCount;
                    // 真卡墙时立即沿可通行方向脱困，不再用“原地罚站”处理。
                    // 有目标时仍保留目标并可边脱困边还击。
                    boss.bossUnstuckDir = this.pickBossRecoveryDirection(
                        boss,
                        center,
                        radius,
                    );
                    boss.bossUnstuckUntil = now + (boss.bossTarget ? 1000 : 1500);
                    boss.bossStationaryUntil = 0;
                    boss.bossPatrolTimer = 0;
                    boss.bossStuckCount = 0;
                    this.bossRecorder?.recordEvent(this.id, {
                        type: "boss_escape_started",
                        at: now,
                        bossName: boss.name,
                        combat: Boolean(boss.bossTarget),
                        dir: {
                            x: Math.round(boss.bossUnstuckDir.x * 100) / 100,
                            y: Math.round(boss.bossUnstuckDir.y * 100) / 100,
                        },
                        stuckCount: detectedCount,
                    });
                } else {
                    // 正常移动：清空卡墙计数。
                    boss.bossStuckCount = 0;
                }
            }

            let target: Player | null = null;
            let best = Infinity;
            for (const p of this.playerBarn.players) {
                if (p === boss || p.dead || p.spectatorOnly || p.disconnected || p.serverBot) continue;
                // 楼层过滤：Boss 只索敌同层玩家。否则楼上 Boss 会跨层锁定
                // 地下室（layer 2）/地面玩家，而子弹层豁免（2 & layer）会让
                // 地下室玩家被楼上 Boss 隔层打死。
                if (!util.sameLayer(boss.layer, p.layer)) continue;
                const d = v2.distance(boss.pos, p.pos);
                if (d < best) {
                    best = d;
                    target = p;
                }
            }

            // 只在 Boss 未越界时接受新目标；目标稍出圈也可以追（Boss 追到
            // 巡逻边界会自动放弃回位）。
            const distFromCenter = v2.distance(boss.pos, center);
            const targetInZone = target
                ? rangeUnlocked || v2.distance(target.pos, center) <= radius * 1.3
                : false;
            // 当前目标失效立即放弃（换人/回巡逻），不拖到下帧：
            // 死亡、掉线、逃出追击范围、目标出圈、目标换层都不再追。
            if (boss.bossTarget) {
                const cur = boss.bossTarget;
                const curD = v2.distance(boss.pos, cur.pos);
                const curInZone = v2.distance(cur.pos, center) <= radius * 1.3;
                // 首次受到有效伤害后永久取消追击距离；旧的短时
                // hit-chase 仍用于防止受击后立即因无视线放弃攻击者。
                const chasing = now < boss.bossHitChaseUntil;
                const chaseLimit = rangeUnlocked ? Infinity : chasing ? 200 : chaseRange;
                if (
                    cur.dead
                    || cur.disconnected
                    || curD > chaseLimit
                    || (!curInZone && !chasing && !rangeUnlocked)
                    || !util.sameLayer(boss.layer, cur.layer)
                ) {
                    boss.bossTarget = null;
                }
            }
            // 当前目标躲在掩体后（视线被挡）而附近存在可见玩家 →
            // 立即切换攻击可见的最近者（不等 2 秒 LOS 计时 + 冷却，
            // 否则 B 出现后 Boss 会发呆最多 3.5 秒）。冷却只针对
            // 被放弃的旧目标，不影响新出现的可见目标。
            if (
                boss.bossTarget
                && !boss.bossTarget.dead
                && !boss.bossTarget.disconnected
                && now >= boss.bossHitChaseUntil
            ) {
                const curLos = this.bossHasClearShot(
                    boss.pos,
                    boss.bossTarget.pos,
                    boss.layer,
                );
                if (!curLos) {
                    // 当前目标不可见 → 扫描所有玩家找可见的最近者切换。
                    // 只在目标藏掩体时执行（正常战斗路径零开销）。
                    let visBest = Infinity;
                    let visTarget: Player | null = null;
                    for (const p of this.playerBarn.players) {
                        if (
                            p === boss
                            || p === boss.bossTarget
                            || p.dead
                            || p.spectatorOnly
                            || p.disconnected
                            || p.serverBot
                            || !util.sameLayer(boss.layer, p.layer)
                        ) {
                            continue;
                        }
                        const d = v2.distance(boss.pos, p.pos);
                        if ((!rangeUnlocked && d > chaseRange) || d >= visBest) continue;
                        if (!rangeUnlocked && v2.distance(p.pos, center) > radius * 1.3) continue;
                        if (!this.bossHasClearShot(boss.pos, p.pos, boss.layer)) {
                            continue;
                        }
                        visBest = d;
                        visTarget = p;
                    }
                    if (visTarget) {
                        this.logger.info(
                            `[boss] switched target: ${boss.bossTarget.name} (cover) -> ${visTarget.name} (visible)`,
                        );
                        boss.bossTarget = visTarget;
                        boss.bossNoLosSince = 0;
                        boss.bossReturnTimer = 0;
                    }
                }
            }
            // 无目标时锁定最近的合法目标（best 每帧重估 → 索敌切换及时）。
            // 冷却只针对被放弃的旧目标：新目标（不同 __id）不受冷却限制。
            if (
                !boss.bossTarget
                && target
                && (now >= boss.bossTargetNoLosUntil
                    || target.__id !== boss.bossNoLosTargetId)
                && (rangeUnlocked || best < chaseRange)
                && (rangeUnlocked || distFromCenter < radius)
                && targetInZone
            ) {
                boss.bossTarget = target;
                boss.bossReturnTimer = 0;
            }

            let moveDir: { x: number; y: number } | null = null;
            let shouldShoot = false;

            if (
                now < boss.bossUnstuckUntil
                && boss.bossTarget
                && !boss.bossTarget.dead
                && !boss.bossTarget.disconnected
            ) {
                // 战斗中卡墙：脱困移动优先于继续顶墙，但视线清晰时仍会
                // 朝攻击者还击，避免“有目标却站着挨打”。
                const tPos = boss.bossTarget.pos;
                const d = v2.distance(boss.pos, tPos);
                const hasLOS = this.bossHasClearShot(boss.pos, tPos, boss.layer);
                boss.bossDecision = "combat-escape";
                boss.bossTargetDist = d;
                boss.bossHasLosNow = hasLOS;
                moveDir = boss.bossUnstuckDir;
                shouldShoot = d <= attackRange
                    && hasLOS
                    && boss.actionType !== GameConfig.Action.Reload
                    && boss.actionType !== GameConfig.Action.ReloadAlt;
            } else if (boss.bossTarget && !boss.bossTarget.dead && !boss.bossTarget.disconnected) {
                const tPos = boss.bossTarget.pos;
                const d = v2.distance(boss.pos, tPos);
                boss.bossTargetDist = d;
                const dFromCenter = v2.distance(boss.pos, center);
                // 视线检查：Boss 与目标之间隔墙（同层可碰撞物）时不射击，
                // 避免 Boss 对着墙空开枪。
                const hasLOS = this.bossHasClearShot(boss.pos, tPos, boss.layer);
                boss.bossHasLosNow = hasLOS;
                // 目标被掩体完全挡住（连续无视线 2 秒）→ 放弃该目标换人，
                // 防止 Boss 对墙后目标死追/顶墙循环、不切换索敌。
                // 受击追击期（bossHitChaseUntil 内）不因无视线放弃：
                // Boss 继续朝攻击者方向移动，绕出掩体后恢复射击。
                const chasing = now < boss.bossHitChaseUntil;
                if (hasLOS) {
                    boss.bossNoLosSince = 0;
                } else {
                    if (boss.bossNoLosSince === 0) boss.bossNoLosSince = now;
                    // 无视线放弃：给绕行前压留 4 秒（Boss 沿墙试探绕行，
                    // 找到窗口即可射击交战/救援中的玩家；4 秒仍无视线才放弃）。
                    if (now - boss.bossNoLosSince >= 4000 && !chasing) {
                        const abandoned = boss.bossTarget;
                        boss.bossTarget = null;
                        // 冷却 1.5 秒内不再重新锁定同一目标（可换别的玩家）。
                        boss.bossTargetNoLosUntil = now + 1500;
                        boss.bossNoLosTargetId = abandoned?.__id ?? 0;
                        boss.bossNoLosSince = 0;
                        this.logger.info(
                            `[boss] abandoned target (no LOS 4s): ${abandoned?.name ?? "?"}`,
                        );
                    }
                }

                if (!rangeUnlocked && dFromCenter >= radius) {
                    // 已到巡逻边界：不追出圈，朝中心回拉；仍在攻击距离内就射击。
                    boss.bossReturnTimer = now;
                    boss.bossRetreating = false;
                    boss.bossDecision = "edge";
                    moveDir = v2.normalize(v2.sub(center, boss.pos));
                    shouldShoot = d <= attackRange && hasLOS;
                } else if (
                    boss.actionType === GameConfig.Action.Reload
                    || boss.actionType === GameConfig.Action.ReloadAlt
                ) {
                    // 换弹中：沿目标切线侧向走位（绕目标横向移动）。
                    // 换弹不能射击，也不朝目标推进（保持交战距离），
                    // 单方向平滑移动避免 9 距离边界往返抽动。
                    const toTarget = v2.normalize(v2.sub(tPos, boss.pos));
                    boss.bossDecision = "reload";
                    moveDir = { x: -toTarget.y, y: toTarget.x };
                    shouldShoot = false;
                } else if (d < 9) {
                    // 过近：后撤拉开距离。两处原因：枪口 barrelLength 偏移使
                    // 贴脸子弹出生在目标身后；且 <7 距离的子弹单帧位移即越过
                    // 目标（网格线段查询漏查），近距射击命中率≈0。
                    // 换弹时同样走位（移动照常，不开枪由武器系统处理）。
                    boss.bossRetreating = true;
                    boss.bossDecision = "retreat";
                    moveDir = v2.normalize(v2.sub(boss.pos, tPos));
                    shouldShoot = d >= 7 && hasLOS;
                } else if (d < 11 && boss.bossRetreating) {
                    // 滞回：撤到 11 才恢复前进，防止 9 距离边界每 tick
                    // 前进/后撤翻转造成的抽动。换弹时同样正常走位。
                    boss.bossDecision = "retreat-hysteresis";
                    moveDir = v2.normalize(v2.sub(boss.pos, tPos));
                    shouldShoot = d >= 7 && hasLOS;
                } else {
                    boss.bossRetreating = false;
                    if (!hasLOS && (rangeUnlocked || chasing || d <= chaseRange)) {
                        // 前压绕行：目标在墙后（交战中/救人）→ 朝目标推进并
                        // 叠加垂直分量试探绕墙（每 2.5 秒交替一侧），
                        // 沿墙滑动寻找窗口，而不是直线顶墙站桩。
                        const toTarget = v2.normalize(v2.sub(tPos, boss.pos));
                        const perp = v2.normalize({
                            x: -toTarget.y,
                            y: toTarget.x,
                        });
                        if (now >= boss.bossFlankNextAt) {
                            boss.bossFlankSign = -boss.bossFlankSign;
                            boss.bossFlankNextAt = now + 2500;
                        }
                        boss.bossDecision = "flank";
                        moveDir = v2.normalize(
                            v2.add(
                                v2.mul(toTarget, 0.65),
                                v2.mul(perp, boss.bossFlankSign * 0.35),
                            ),
                        );
                        shouldShoot = false;
                    } else {
                        boss.bossDecision = "chase";
                        moveDir = v2.normalize(v2.sub(tPos, boss.pos));
                        shouldShoot = d <= attackRange && hasLOS;
                    }
                    if (d > attackRange) {
                        boss.bossPatrolTimer = -1;
                    }
                }
            }

            if (
                !moveDir
                && !shouldShoot
                && boss.actionType !== GameConfig.Action.Reload
                && boss.actionType !== GameConfig.Action.ReloadAlt
            ) {
                boss.bossTarget = null;
                boss.bossPatrolTimer -= dt;

                if (now < boss.bossUnstuckUntil) {
                    // 脱困优先于回位；否则回位路径一旦撞墙，会持续覆盖
                    // 已选好的逃逸方向，Boss 看起来仍在原地顶墙。
                    boss.bossDecision = "escape";
                    moveDir = boss.bossUnstuckDir;
                    boss.bossPatrolTimer = 0;
                } else if (boss.bossReturnTimer > 0) {
                    boss.bossDecision = "return";
                    moveDir = v2.normalize(v2.sub(center, boss.pos));
                    if (v2.distance(boss.pos, center) < arrival) boss.bossReturnTimer = 0;
                } else {
                    // 巡逻：到达目标点后停下等待换点（防抽搐）。
                    const dTarget = v2.distance(boss.pos, boss.bossPatrolTarget);
                    if (dTarget < arrival) {
                        if (boss.bossPatrolTimer <= 0) {
                            // 已到达且计时结束 → 换下一个巡逻点（直线可达）
                            this.pickBossPatrolTarget(boss, center, radius, now);
                            boss.bossPatrolTimer = 3 + Math.random() * 4;
                            if (v2.distance(boss.pos, boss.bossPatrolTarget) >= arrival) {
                                boss.bossDecision = "patrol";
                                moveDir = v2.normalize(v2.sub(boss.bossPatrolTarget, boss.pos));
                            } else {
                                boss.bossDecision = "patrol-wait";
                                moveDir = null;
                            }
                        } else {
                            // 到达但计时未结束 → 停下等待
                            boss.bossDecision = "patrol-wait";
                            moveDir = null;
                        }
                    } else if (boss.bossPatrolTimer <= 0 || dTarget > radius * 1.5) {
                        // 计时结束（或目标异常出界）→ 重新选点（直线可达）
                        this.pickBossPatrolTarget(boss, center, radius, now);
                        boss.bossPatrolTimer = 3 + Math.random() * 4;
                        if (v2.distance(boss.pos, boss.bossPatrolTarget) >= arrival) {
                            boss.bossDecision = "patrol";
                            moveDir = v2.normalize(v2.sub(boss.bossPatrolTarget, boss.pos));
                        } else {
                            boss.bossDecision = "patrol-wait";
                            moveDir = null;
                        }
                    } else {
                        boss.bossDecision = "patrol";
                        moveDir = v2.normalize(v2.sub(boss.bossPatrolTarget, boss.pos));
                    }
                }
            }

            boss.bossMoveDir = moveDir
                ? { x: moveDir.x, y: moveDir.y }
                : { x: 0, y: 0 };

            if (moveDir) {
                boss.moveLeft = moveDir.x < -0.2;
                boss.moveRight = moveDir.x > 0.2;
                boss.moveUp = moveDir.y > 0.2;
                boss.moveDown = moveDir.y < -0.2;
            } else {
                boss.moveLeft = false;
                boss.moveRight = false;
                boss.moveUp = false;
                boss.moveDown = false;
            }
            // Movement and weapon aim are independent: when returning to the patrol
            // area or backing away, keep the muzzle on the attacker instead of
            // aiming along the movement vector.
            if (shouldShoot && boss.bossTarget) {
                boss.dir = v2.normalize(v2.sub(boss.bossTarget.pos, boss.pos));
            } else if (moveDir) {
                boss.dir = v2.create(moveDir.x, moveDir.y);
            }
            // 玩家 update() 每 tick 用 dirNew 覆盖 dir（dirNew 仅由客户端
            // InputMsg 更新）。Boss 没有真实客户端输入，若不同步 dirNew，
            // AI 设定的朝向会在同帧被重置回出生默认 (1,0)，表现为 Boss
            // 永远朝东、不转向（子弹也固定向东飞）。
            boss.dirNew = v2.copy(boss.dir);
            boss.shootStart = shouldShoot;
            boss.shootHold = shouldShoot;
            boss.setDirty();
        }
    }

    /**
     * 为卡墙 Boss 选择一条短距离可通行且不会冲出巡逻区的脱困方向。
     * 有战斗目标时优先横移/后撤；其余候选覆盖一整圈，最后才回中心。
     */
    private pickBossRecoveryDirection(
        boss: Player,
        center: Vec2,
        radius: number,
    ): Vec2 {
        const candidates: Vec2[] = [];
        const target = boss.bossTarget;
        if (target && util.sameLayer(boss.layer, target.layer)) {
            const dx = target.pos.x - boss.pos.x;
            const dy = target.pos.y - boss.pos.y;
            const len = Math.hypot(dx, dy);
            if (len > 0.001) {
                const tx = dx / len;
                const ty = dy / len;
                boss.bossFlankSign = -boss.bossFlankSign;
                candidates.push(
                    v2.create(-ty * boss.bossFlankSign, tx * boss.bossFlankSign),
                    v2.create(ty * boss.bossFlankSign, -tx * boss.bossFlankSign),
                    v2.create(-tx, -ty),
                );
            }
        }

        const centerDx = center.x - boss.pos.x;
        const centerDy = center.y - boss.pos.y;
        if (Math.hypot(centerDx, centerDy) > 0.001) {
            candidates.push(v2.create(centerDx, centerDy));
        }
        const angleOffset = Math.random() * Math.PI * 2;
        for (let i = 0; i < 12; i++) {
            const angle = angleOffset + (i * Math.PI * 2) / 12;
            candidates.push(v2.create(Math.cos(angle), Math.sin(angle)));
        }

        for (const candidate of candidates) {
            const len = Math.hypot(candidate.x, candidate.y);
            if (len <= 0.001) continue;
            const dir = v2.create(candidate.x / len, candidate.y / len);
            const endpoint = v2.add(boss.pos, v2.mul(dir, 7));
            if (!boss.bossRangeUnlocked && v2.distance(endpoint, center) > radius * 0.98) continue;
            if (this.hasClearWalkPath(boss.pos, endpoint, boss.layer)) return dir;
        }

        // 极端情况下没有 7 单位的完整通路，仍向中心尝试，避免返回零向量。
        const fallbackLen = Math.hypot(centerDx, centerDy);
        if (fallbackLen > 0.001) {
            return v2.create(centerDx / fallbackLen, centerDy / fallbackLen);
        }
        return v2.create(Math.cos(angleOffset), Math.sin(angleOffset));
    }

    /**
     * 选择 Boss 巡逻目标：多候选 + 直线可达性检查（Boss 无寻路，
     * 若目标与当前位置之间隔墙，Boss 会卡墙抽搐）。找不到可达点就原地待着。
     */
    private pickBossPatrolTarget(
        boss: Player,
        center: Vec2,
        radius: number,
        timestamp: number,
    ): void {
        for (let attempt = 0; attempt < 10; attempt++) {
            const angle = Math.random() * Math.PI * 2;
            const r = Math.random() * radius * 0.7 + radius * 0.2;
            const candidate = v2.create(
                center.x + Math.cos(angle) * r,
                center.y + Math.sin(angle) * r,
            );
            const proj = this.map.findSpawnableNear("boss_totem", candidate, radius, boss.layer)
                ?? candidate;
            if (this.hasClearWalkPath(boss.pos, proj, boss.layer)) {
                boss.bossPatrolTarget = proj;
                return;
            }
        }
        // 找不到可达点：原地待着（守住当前位置）。
        boss.bossPatrolTarget = v2.copy(boss.pos);
    }

    /** 直线可达性：Boss 到目标直线路径上无同层可碰撞物（AABB + 采样双重检查）。 */
    private hasClearWalkPath(from: Vec2, to: Vec2, layer: number): boolean {
        const dist = Math.hypot(to.x - from.x, to.y - from.y);
        if (dist < 0.6) return true;
        const steps = Math.max(2, Math.ceil(dist / 0.5));
        for (let i = 1; i < steps; i++) {
            const t = i / steps;
            const x = from.x + (to.x - from.x) * t;
            const y = from.y + (to.y - from.y) * t;
            if (!this.map.isPlayerWalkableAt(v2.create(x, y), layer, 0.6)) {
                return false;
            }
        }
        return true;
    }

    /** 线段与 AABB（Liang-Barsky）是否相交。 */
    private segmentHitsAabb(
        p0: Vec2,
        p1: Vec2,
        minX: number,
        minY: number,
        maxX: number,
        maxY: number,
    ): boolean {
        let tMin = 0;
        let tMax = 1;
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const clip = (p: number, q: number): boolean => {
            if (Math.abs(p) < 1e-9) return q >= 0;
            const r = q / p;
            if (p < 0) {
                if (r > tMax) return false;
                if (r > tMin) tMin = r;
            } else {
                if (r < tMin) return false;
                if (r < tMax) tMax = r;
            }
            return true;
        };
        return (
            clip(-dx, p0.x - minX)
            && clip(dx, maxX - p0.x)
            && clip(-dy, p0.y - minY)
            && clip(dy, maxY - p0.y)
        );
    }

    /** 点到线段距离。 */
    private segmentPointDistance(p0: Vec2, p1: Vec2, p: Vec2): number {
        const vx = p1.x - p0.x;
        const vy = p1.y - p0.y;
        const lenSq = vx * vx + vy * vy;
        if (lenSq < 1e-9) return Math.hypot(p.x - p0.x, p.y - p0.y);
        let t = ((p.x - p0.x) * vx + (p.y - p0.y) * vy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const cx = p0.x + vx * t;
        const cy = p0.y + vy * t;
        return Math.hypot(p.x - cx, p.y - cy);
    }

    /** Boss 视线：Boss→目标 直线与同层可碰撞物是否相交。
     *  Boss 本体已在墙 AABB 内（贴墙）时不把该墙算遮挡，避免贴墙空开枪判断误伤。 */
    private bossHasClearShot(from: Vec2, to: Vec2, layer: number): boolean {
        for (const obj of this.objectRegister.objects) {
            if (!obj) continue;
            const o = obj as unknown as {
                __type?: number;
                dead?: boolean;
                collidable?: boolean;
                layer?: number;
                pos: Vec2;
                rad?: number;
                type?: string;
                bounds?: { min?: Vec2; max?: Vec2 };
            };
            const isSolid = o.collidable === true
                || o.__type === ObjectType.Building
                || o.__type === ObjectType.Structure;
            if (!isSolid || o.dead) continue;
            // 窗户/灌木/草/烟：不挡 Boss 弹道（与 AI 射击线一致）。
            // 窗户 1hp 一发即碎、子弹穿透；玻璃墙（glass_wall_*）仍挡弹道，
            // Boss 不会对着玻璃墙傻射。
            if (o.type && isBulletTransparentObstacleType(o.type)) continue;
            if (Number(o.layer ?? 0) !== layer) continue;
            if (o.bounds?.min && o.bounds?.max) {
                // 对象 bounds 是局部坐标（围绕自身原点），必须平移到世界坐标，
                // 否则与 Boss→目标线段（世界坐标）永远不相交 → 隔墙误判可射击。
                const bMin = v2.add(o.bounds.min, o.pos);
                const bMax = v2.add(o.bounds.max, o.pos);
                // 粗筛：离 Boss 太远的障碍物不影响 40 射程内的射击。
                // 用平方距离避免 Math.hypot（每 tick 每 Boss 全遍历对象，省 sqrt）。
                const nearX = Math.max(bMin.x, Math.min(from.x, bMax.x));
                const nearY = Math.max(bMin.y, Math.min(from.y, bMax.y));
                const ddx = nearX - from.x;
                const ddy = nearY - from.y;
                if (ddx * ddx + ddy * ddy > 1600) continue;
                if (
                    from.x >= bMin.x && from.x <= bMax.x
                    && from.y >= bMin.y && from.y <= bMax.y
                ) {
                    continue; // Boss 已在该墙内（贴墙），此墙不挡自己
                }
                if (this.segmentHitsAabb(from, to, bMin.x, bMin.y, bMax.x, bMax.y)) {
                    return false;
                }
            } else {
                const objRad = o.rad ?? 0.5;
                const ddx = o.pos.x - from.x;
                const ddy = o.pos.y - from.y;
                if (ddx * ddx + ddy * ddy > (40 + objRad) * (40 + objRad)) continue;
                if (this.segmentPointDistance(from, to, o.pos) < objRad) return false;
            }
        }
        return true;
    }

    applyExtractionSpawnLoadout(player: Player): void {
        if (player.extractionLoadoutGranted) return;
        if (player.serverBot) {
            player.extractionLoadoutGranted = true;
            const secretMode = this.extractionSecretEnabled;
            const preset = pickWeightedExtractionLoadout(
                secretMode
                    ? this.config.extractionSecretAiLoadouts
                        ?? Config.extractionSecretAiLoadouts
                    : this.config.extractionAiLoadouts ?? Config.extractionAiLoadouts,
            );
            if (preset) player.applyExtractionLoadout(specToGrantedLoadout(preset));
            if (secretMode) player.applySecretAiKit();
            player.applyExtractionInfiniteKit();
            return;
        }
        const stashKey = player.stashName || player.name;
        if (!stashKey) {
            this.logger.warn(
                `Player ${player.name} has no stash identity; cannot grant extraction loadout`,
            );
            player.extractionLoadoutGranted = true;
            return;
        }
        const granted = stashManager.grantLoadout(stashKey);
        if (granted) {
            // 复核实际发放的武器：配装可能在资格校验后、进局发放前被
            // 玩家改掉（如加载期间取消配装/换 B 级枪）→ 绝密必须至少
            // 一把 A/S/S+ 武器实发，否则拒绝，防"空手进绝密"。
            if (
                this.extractionSecretEnabled
                && !granted.weapons.some(
                    (g) => g?.type && isSecretEligibleWeapon(g.type),
                )
            ) {
                this.logger.warn(
                    `Player "${player.name}" rejected from secret extraction: loadout no longer contains an eligible weapon`,
                );
                // grantLoadout 已经原子扣仓并写入 pending；资格复核失败时玩家
                // 尚未真正进入对局，必须立即归还全部配装（包括一次性能力）。
                // 若持久化暂时失败，pending 仍会在服务器重启时自动恢复。
                try {
                    stashManager.recoverPendingGrant(stashKey);
                } catch (error) {
                    this.logger.warn(
                        `[stash] failed to refund rejected secret loadout for "${player.name}":`,
                    );
                    console.error(error);
                }
                player.client.disconnect("invalid_token");
                return;
            }
            player.applyExtractionLoadout(granted);
            player.extractionLoadoutGranted = true;
        } else if (this.extractionSecretEnabled) {
            // 绝密：配装已空（加载期间取消配装等）→ 拒绝进入，
            // 而不是裸进（校验时合格、发放时空配装）。
            this.logger.warn(
                `Player "${player.name}" rejected from secret extraction: bring-in loadout is now empty`,
            );
            player.client.disconnect("invalid_token");
        } else {
            this.logger.warn(
                `Player "${player.name}" (stash="${stashKey}") has no bring-in loadout configured`,
            );
        }
    }

    /** 搜打撤·绝密模式是否生效。
     *  只有两种来源：地图本身是绝密地图（extractionSecretMode 标志），
     *  或建房间时显式传入绝密快照（生产多进程由 gameManager 按 mapName
     *  推导：mode.mapName === "extraction_secret"）。
     *  全局 Config.extractionSecret.enabled 只控制绝密播放列表是否开放，
     *  绝不能作为对局行为的回退——否则普通搜打撤也会被误判为绝密。 */
    get extractionSecretEnabled(): boolean {
        return (
            (this.map.mapDef.gameMode.extractionSecretMode
                || this.config.extractionSecretEnabled === true)
            && Boolean(this.map.mapDef.gameMode.extractionMode)
        );
    }
}
