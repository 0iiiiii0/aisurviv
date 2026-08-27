import { isDuelMapName } from "../../../shared/defs/duelMapNames.ts";
import { MIN_JOINABLE_REMAINING_SECONDS } from "../../../shared/defs/extractionDefs.ts";
import { MapDefs } from "../../../shared/defs/mapDefs.ts";
import { TeamMode } from "../../../shared/gameConfig.ts";
import { Config, type ExtractionAiLoadoutPresetConfig, type ModeConfig } from "../config.ts";
import type { DuelAiDifficulty } from "../duelLoadout.ts";
import type { DuelPlayerWeapons } from "../duelMatchTypes.ts";

export interface ServerGameConfig {
    readonly mapName: keyof typeof MapDefs;
    readonly teamMode: TeamMode;
    readonly privateGame?: boolean;
    readonly duelWeapons?: readonly [string, string];
    /** Per-contestant weapon pairs. Index is supplied by the join token. */
    readonly duelPlayerLoadouts?: readonly DuelPlayerWeapons[];
    readonly duelAdrenalineEnabled?: boolean;
    readonly duelBoost?: number;
    readonly duelHelmetLevel?: 0 | 1 | 2 | 3;
    readonly duelChestLevel?: 0 | 1 | 2 | 3;
    readonly duelScope?: "1xscope" | "2xscope" | "4xscope" | "8xscope" | "15xscope";
    readonly duelThrowables?: Readonly<Record<string, number>>;
    /** AI challenge metadata is snapshotted into the room for authoritative achievement checks. */
    readonly duelAiEnabled?: boolean;
    readonly duelAiDifficulty?: DuelAiDifficulty;
    readonly duelDefaultLoadout?: boolean;
    readonly aimTrainingWeapon?: string;
    readonly aimTrainingWeapon1?: string;
    readonly aimTrainingThrowable?: string;
    readonly aimTrainingInfiniteMagazine?: boolean;
    readonly aimTrainingTargetBoost?: number;
    readonly aimTrainingHelmetLevel?: number;
    readonly aimTrainingChestLevel?: number;
    readonly aimTrainingNormalHealth?: boolean;
    readonly aimTrainingDistance?: number;
    readonly aimTrainingVerticalRandomMovement?: boolean;
    readonly aimTrainingOmnidirectionalRandomMovement?: boolean;
    readonly aimTrainingDodgeBullets?: boolean;
    /** Effective public-room capacity after applying the shared team-size limit. */
    readonly maxPlayersOverride?: number;
    /** 搜打撤 AI 默认配装（随房间创建快照下发，后台修改即时生效）。 */
    readonly extractionAiLoadouts?: readonly ExtractionAiLoadoutPresetConfig[];
    /** 绝密模式 AI 配装（独立于普通搜打撤 AI，随房间创建快照下发）。 */
    readonly extractionSecretAiLoadouts?: readonly ExtractionAiLoadoutPresetConfig[];
    /** 搜打撤·绝密模式开关（建房间时主进程配置快照，生产多进程下与 worker 一致）。 */
    readonly extractionSecretEnabled?: boolean;
    /** 搜打撤 Boss 开关（建房间时主进程配置快照：后台关闭后新局不再生成
     *  Boss——多进程下子进程的全局 Config 是启动时的旧值，必须走快照）。 */
    readonly extractionBossEnabled?: boolean;
    /** Keeps an administrator-created bot-only room alive for spectators. */
    readonly pureAiMatch?: boolean;
    /** 僵尸模式难度（建房间时快照）。 */
    readonly zombieDifficulty?: "simple" | "normal" | "hard";
}

/** Public queues respect the enabled flag; invite-code team rooms may start an
 * unlisted duo/squad playlist. This policy must be identical in the single-
 * thread and production multi-process managers. */
export function isMatchmakingPlaylistAvailable(
    mode: Pick<ModeConfig, "enabled"> | undefined,
    teamRoom = false,
): boolean {
    return Boolean(mode && (mode.enabled || teamRoom));
}

/**
 * The all-modes menu may start configured but unlisted public playlists.
 * Extraction remains exclusive to its dedicated, account-aware entry points.
 */
export function isPublicPlaylistAvailable(
    mode: Pick<ModeConfig, "enabled" | "mapName"> | undefined,
    allowUnlistedMode = false,
): boolean {
    if (!mode) return false;
    const isExtraction = mode.mapName === "extraction"
        || mode.mapName === "extraction_secret";
    if (allowUnlistedMode && isExtraction) return false;
    return mode.enabled || allowUnlistedMode;
}

export function getConfiguredRoomPlayerLimit(teamMode: TeamMode): number {
    switch (teamMode) {
        case 2:
            return Config.roomPlayerLimits.duo;
        case 4:
            return Config.roomPlayerLimits.squad;
        default:
            return Config.roomPlayerLimits.solo;
    }
}

/**
 * Effective room capacity for a playlist. 绝密搜打撤 has its own per-team-size
 * AI fill target (solo/duo/squad configured separately); when that target is
 * larger than the shared team-size room limit (e.g. squad 20 vs 绝密四人 30),
 * the room must be allowed to grow to the secret target, otherwise the match
 * starts permanently under-filled ("四人绝密开局卡住 / AI 永远补不满").
 */
export function getEffectiveRoomPlayerLimit(
    mapName: string,
    teamMode: TeamMode,
): number {
    const base = getConfiguredRoomPlayerLimit(teamMode);
    if (mapName === "extraction_secret") {
        const target = Math.max(
            0,
            Math.floor(
                Number(
                    teamMode === TeamMode.Solo
                        ? Config.botAutoFill
                            .extractionSecretSoloTargetPlayerCount
                        : teamMode === TeamMode.Duo
                        ? Config.botAutoFill
                            .extractionSecretDuoTargetPlayerCount
                        : Config.botAutoFill
                            .extractionSecretSquadTargetPlayerCount,
                ) || 0,
            ),
        );
        if (target > 0) return Math.max(base, target);
    }
    return base;
}

/**
 * Matchmaking readiness comparator used by findGame(). Prefers rooms that
 * already contain human contestants (social matchmaking), then rooms with more
 * contestants (bot fill progress), then the oldest room. A fresh empty room is
 * only selected when no populated room exists, which avoids repeatedly
 * dropping humans into rooms that still need to wait for bot auto-fill.
 */
export function compareMatchmakingReadiness(
    a: Pick<GameData, "humanPlayerCount" | "serverBotCount" | "startedTime">,
    b: Pick<GameData, "humanPlayerCount" | "serverBotCount" | "startedTime">,
): number {
    const aHasHumans = a.humanPlayerCount > 0 ? 1 : 0;
    const bHasHumans = b.humanPlayerCount > 0 ? 1 : 0;
    if (aHasHumans !== bHasHumans) return bHasHumans - aHasHumans;
    const aContestants = a.humanPlayerCount + a.serverBotCount;
    const bContestants = b.humanPlayerCount + b.serverBotCount;
    if (aContestants !== bContestants) return bContestants - aContestants;
    return a.startedTime - b.startedTime;
}

export function createServerGameConfig(
    mode: Pick<ServerGameConfig, "mapName" | "teamMode">,
    zombieDifficulty?: "simple" | "normal" | "hard",
): ServerGameConfig {
    const mapDef = MapDefs[mode.mapName];
    const usesSharedTeamSizeLimit = !isDuelMapName(mode.mapName)
        && mode.mapName !== "aim_training"
        && !mapDef.gameMode.factionMode;
    return {
        mapName: mode.mapName,
        teamMode: mode.teamMode,
        ...(zombieDifficulty ? { zombieDifficulty } : {}),
        ...(usesSharedTeamSizeLimit
            ? {
                maxPlayersOverride: getEffectiveRoomPlayerLimit(
                    mode.mapName,
                    mode.teamMode,
                ),
            }
            : {}),
        ...(mode.mapName === "extraction" || mode.mapName === "extraction_secret"
            ? {
                extractionAiLoadouts: Config.extractionAiLoadouts,
                extractionSecretAiLoadouts: Config.extractionSecretAiLoadouts,
                // 绝密搜打撤是独立播放列表：绝密地图的房间固定按绝密规则运行，
                // 普通搜打撤房间始终按普通规则运行，二者可同时存在。
                extractionSecretEnabled: mode.mapName === "extraction_secret",
                // Boss 开关快照：后台关闭后新建对局不再生成 Boss
                // （生产多进程下子进程 Config 是启动旧值，必须随房间下发）。
                extractionBossEnabled: Config.extractionBoss.enabled,
            }
            : {}),
        ...(isDuelMapName(mode.mapName)
            ? {
                duelWeapons: [...Config.duel.weapons] as [string, string],
                duelAdrenalineEnabled: Config.duel.adrenalineEnabled,
                duelBoost: Config.duel.adrenalineEnabled ? Config.duel.boost : 0,
                duelHelmetLevel: Config.duel.helmetLevel,
                duelChestLevel: Config.duel.chestLevel,
                duelScope: Config.duel.scope,
                duelThrowables: { ...Config.duel.throwables },
            }
            : {}),
    };
}

export interface GameData {
    id: string;
    teamMode: TeamMode;
    mapName: string;
    /** Authoritative procedural-map seed; populated by isolated room processes. */
    mapSeed?: number;
    /** Authoritative zombie room difficulty snapshot used by multi-process matchmaking. */
    zombieDifficulty?: "simple" | "normal" | "hard";
    canJoin: boolean;
    /** 搜打撤·绝密模式（建房间时快照，房间内补员/规则一致）。 */
    extractionSecretEnabled?: boolean;
    aliveCount: number;
    connectedCount: number;
    /** Connected real contestants, including dead players but excluding spectator-only clients. */
    humanPlayerCount: number;
    /** 掉线但未阵亡、仍可重连入局的真人（搜打撤不限时保留，补员时视为真人占位）。 */
    pendingHumanCount?: number;
    /** Connected server-controlled AI contestants, including dead bots not yet disconnected. */
    aiPlayerCount: number;
    /** Connected spectator-only clients. */
    spectatorCount: number;
    serverBotCount: number;
    /** Cumulative human + smart-bot admissions for this match. */
    contestantAdmissionCount: number;
    /** Connected auto-fill bots per faction, indexed by teamId - 1. */
    serverBotTeamCounts: number[];
    reservedHumanCount: number;
    /** Valid smart-bot token uses not yet admitted to the room. */
    reservedBotCount?: number;
    startedTime: number;
    stopped: boolean;
    /** Match outcome already resolved (room is winding down / about to stop). */
    over?: boolean;
    privateGame: boolean;
    /** Admin capability matches own their exact bot roster. */
    pureAiMatch?: boolean;
    duelAdrenalineEnabled?: boolean;
    arenaRound?: number;
    totalRounds?: number;
    arenaScores?: Record<string, number>;
    /** Health of the isolated room child process. Omitted in single-thread development mode. */
    processHealth?: "healthy" | "warning" | "fault";
    processPid?: number;
    lastProcessFault?: {
        at: number;
        stage: string;
        message: string;
        fatal: boolean;
        consecutive: number;
        recent: number;
    };
}

/** A dashboard row must describe a live room rather than an ended/stale worker snapshot. */
export function isAdminVisibleGame(game: GameData): boolean {
    return (
        !game.stopped
        && !game.over
        && game.processHealth !== "warning"
        && game.processHealth !== "fault"
    );
}

/** Spectating additionally requires at least one living contestant. */
export function isGameSpectatable(game: GameData): boolean {
    return isAdminVisibleGame(game) && game.aliveCount > 0;
}

export interface MatchmakingFillInfo {
    humanPlayers: number;
    botPlayers: number;
    totalPlayers: number;
    targetPlayers: number;
    reservedPlayers: number;
}

export interface FindGameResponse {
    gameId: string;
    data: string;
    /** Best-effort lobby fill snapshot for public matchmaking rooms. */
    fill?: MatchmakingFillInfo;
}

/**
 * Compatibility request used by the legacy admin/bot matchmaking helpers.
 * The public Hono API translates its validated request into the newer private
 * matchmaking contract before it reaches the game process manager.
 */
export interface LegacyFindGameBody {
    region: string;
    zones?: string[];
    version: number;
    playerCount: number;
    autoFill: boolean;
    gameModeIdx: number;
    teamRoom?: boolean;
    zombieDifficulty?: "simple" | "normal" | "hard";
}

export abstract class GameManager {
    abstract getPlayerCount(): number;

    abstract getById(id: string): GameData | undefined;

    abstract listGames(): GameData[];

    abstract createGame(config: ServerGameConfig): Promise<GameData>;

    abstract createGameWithJoinTokens(
        config: ServerGameConfig,
        count: number,
        expiresInMs: number,
    ): Promise<FindGameResponse[]>;

    abstract createJoinToken(
        gameId: string,
        expiresInMs: number,
        spectator?: boolean,
        playerCount?: number,
        autoFill?: boolean,
        serverBot?: boolean,
        serverBotTeamIds?: readonly number[],
        duelLoadoutIndex?: number,
    ): Promise<FindGameResponse>;

    /** Revokes an unconsumed token when its client/worker could not be started. */
    revokeJoinToken(_gameId: string, _token: string): boolean {
        return false;
    }

    abstract stopGame(id: string): boolean;

    abstract findGame(body: LegacyFindGameBody): Promise<FindGameResponse>;
}
