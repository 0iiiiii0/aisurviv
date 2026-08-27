import { isDuelMapName } from "../../shared/defs/duelMapNames.ts";
import { MapDefs } from "../../shared/defs/mapDefs.ts";
import { TeamMode } from "../../shared/gameConfig.ts";
import { Config } from "./config.ts";
import { getConfiguredRoomPlayerLimit, getEffectiveRoomPlayerLimit } from "./game/gameManager.ts";
import type { MatchmakingFillInfo } from "./game/gameManager.ts";

export interface BotAutoFillPolicy {
    maxPlayers: number;
    factionMode: boolean;
    /** Number of bots launched by one scheduler action. */
    spawnPerSecond: number;
    /** Shared contestant target for every normal room (humans + bots). */
    targetPlayerCount: number;
    /** Bots reserved inside one smart-bot worker process. */
    processBatchSize?: number;
    /** Delay between bot connections. */
    joinIntervalMs?: number;
}

export interface BotAutoFillRoomState {
    stopped: boolean;
    privateGame: boolean;
    alreadyCompleted: boolean;
    humanPlayerCount?: number;
    reservedHumanCount?: number;
}

/**
 * One public room launches one smart-bot coordinator process for its complete
 * initial deficit. Every AI in that room therefore shares one match world,
 * rather than each fixed-size process retaining another full map copy.
 */
export function resolveBotAutoFillScheduleCount(
    deficit: number,
    policy: Pick<BotAutoFillPolicy, "factionMode" | "processBatchSize">,
    availableWorkerSlots: number,
): number {
    const missing = Math.max(0, Math.floor(deficit));
    const perProcess = Math.max(1, Math.floor(policy.processBatchSize ?? 8));
    if (availableWorkerSlots <= 0) return 0;
    if (!policy.factionMode) return Math.min(missing, perProcess);
    return Math.min(
        missing,
        perProcess * Math.max(0, Math.floor(availableWorkerSlots)),
    );
}

/**
 * Missing contestant slots for a room's initial roster. `admittedContestants`
 * is cumulative for the current match: deaths and disconnects must not create
 * fresh slots, otherwise every eliminated bot starts another worker process.
 * Pending tokens are included until they either join or expire.
 */
export function resolveInitialRosterDeficit(
    maxPlayers: number,
    targetPlayerCount: number,
    admittedContestants: number,
    reservedHumanCount: number,
    pendingBotCount: number,
    reservedBotCount = 0,
): number {
    const target = Math.max(
        0,
        Math.min(
            Math.floor(Number(maxPlayers) || 0),
            Math.floor(Number(targetPlayerCount) || 0),
        ),
    );
    // pendingBotCount mirrors the batch launched by the parent process while
    // reservedBotCount is the authoritative unused-token count reported by the
    // room process. They describe the same seats during normal startup, so use
    // the larger value instead of adding them. This also closes the gap where a
    // slow/crashed worker outlives the parent's pending window but its 120s join
    // token is still reserving the entire batch.
    const pendingOrReservedBots = Math.max(
        Math.max(0, Math.floor(Number(pendingBotCount) || 0)),
        Math.max(0, Math.floor(Number(reservedBotCount) || 0)),
    );
    const occupied = Math.max(0, Math.floor(Number(admittedContestants) || 0))
        + Math.max(0, Math.floor(Number(reservedHumanCount) || 0))
        + pendingOrReservedBots;
    return Math.max(0, target - occupied);
}

/**
 * Public auto-fill starts only after a human joins or reserves a slot. This
 * prevents the server's pre-created room from becoming a pure AI match during
 * startup. Explicit admin AI duels and aim-training targets bypass this policy.
 */
export function shouldAutoFillRoom(state: BotAutoFillRoomState): boolean {
    if (!Config.botAutoFill.enabled || state.stopped) return false;
    if (
        Config.botAutoFill.requireHumanBeforeFill
        && Math.max(0, state.humanPlayerCount ?? 0)
                    + Math.max(0, state.reservedHumanCount ?? 0) <= 0
    ) {
        return false;
    }
    return true;
}

export interface FactionBotSpawnPlanInput {
    connectedBotTeamCounts: readonly number[];
    pendingBotTeamCounts: readonly number[];
    connectedPlayerCount: number;
    reservedHumanCount: number;
    maxPlayers: number;
    targetPlayerCount: number;
    spawnPerSecond: number;
    factionCount?: number;
}

export function getBotAutoFillModeKey(mapName: string, teamMode: TeamMode): string {
    return `${mapName}:${teamMode}`;
}

function normalizeJoinInterval(value: unknown): number {
    return Math.min(
        60000,
        Math.max(
            500,
            Math.round(
                Number(value) || Config.botAutoFill.defaultJoinIntervalMs || 2000,
            ),
        ),
    );
}

/**
 * Resolve the current live auto-fill policy. Each mode family owns its own
 * humans+AI fill target (solo / duo / squad / 50v50), clamped to the room
 * maximum; every playlist also uses the same unified AI join cadence.
 */
export function getBotAutoFillPolicy(
    mapName: string,
    teamMode: TeamMode,
): BotAutoFillPolicy | undefined {
    const mapDef = MapDefs[mapName as keyof typeof MapDefs];
    if (!mapDef) return undefined;
    // Zombie rooms own their server bots: ZombieModeSystem creates and controls
    // the melee horde. Feeding ordinary smart bots through the generic fill
    // scheduler mixes armed AI into the survivors and also prevents the nuclear
    // objective from seeing an empty zombie side after detonation.
    if (
        isDuelMapName(mapName)
        || mapName === "aim_training"
        || mapDef.gameMode.zombieMode
    ) return undefined;

    const mapMaximum = Number(mapDef.gameMode.maxPlayers ?? 80);
    const factionMode = Boolean(mapDef.gameMode.factionMode);
    const maxPlayers = factionMode
        ? Math.min(mapMaximum, Config.roomPlayerLimits.faction)
        : Math.min(
            mapMaximum,
            getEffectiveRoomPlayerLimit(mapName, teamMode),
        );
    // All AI share one unified join interval; per-mode overrides were removed
    // in favour of a single backend-wide cadence.
    const joinIntervalMs = normalizeJoinInterval(
        Config.botAutoFill.defaultJoinIntervalMs,
    );
    // Each mode family owns its own humans+AI fill target; the effective
    // target never exceeds the room maximum.
    // 绝密搜打撤：单人/双人/四人可分别设置独立补齐目标（0 = 跟随普通模式
    // 同队形目标）。
    const secretTarget = mapName === "extraction_secret"
        ? teamMode === TeamMode.Solo
            ? Number(
                Config.botAutoFill.extractionSecretSoloTargetPlayerCount
                    ?? 0,
            )
            : teamMode === TeamMode.Duo
            ? Number(
                Config.botAutoFill.extractionSecretDuoTargetPlayerCount
                    ?? 0,
            )
            : Number(
                Config.botAutoFill
                    .extractionSecretSquadTargetPlayerCount ?? 0,
            )
        : 0;
    const configuredTarget = secretTarget > 0
        ? secretTarget
        : factionMode
        ? Number(Config.botAutoFill.factionTargetPlayerCount)
        : teamMode === TeamMode.Solo
        ? Number(Config.botAutoFill.soloTargetPlayerCount)
        : teamMode === TeamMode.Duo
        ? Number(Config.botAutoFill.duoTargetPlayerCount)
        : Number(Config.botAutoFill.squadTargetPlayerCount);
    const fallbackTarget = factionMode
        ? Number(Config.botAutoFill.squadTargetPlayerCount)
        : 20;
    const baseTarget = Number.isFinite(configuredTarget) && configuredTarget > 0
        ? configuredTarget
        : Number.isFinite(fallbackTarget) && fallbackTarget > 0
        ? fallbackTarget
        : 20;
    const targetPlayerCount = Math.min(
        maxPlayers,
        Math.max(1, Math.floor(Number.isFinite(baseTarget) ? baseTarget : 20)),
    );

    return {
        maxPlayers,
        factionMode,
        spawnPerSecond: 1,
        targetPlayerCount,
        processBatchSize: targetPlayerCount,
        joinIntervalMs,
    };
}

/**
 * Plan forced faction assignments for the next 50v50 bot batch.
 *
 * Pending worker reservations count toward both room capacity and the shared
 * humans+AI target. The next AI is always assigned to the faction with fewer
 * effective server bots, without the obsolete 20+20 hard cap.
 */
export function planFactionBotTeamIds(input: FactionBotSpawnPlanInput): number[] {
    const factionCount = Math.max(
        2,
        input.factionCount ?? 0,
        input.connectedBotTeamCounts.length,
        input.pendingBotTeamCounts.length,
    );
    const effectiveBotCounts = Array.from(
        { length: factionCount },
        (_, index) =>
            Math.max(0, input.connectedBotTeamCounts[index] ?? 0)
            + Math.max(0, input.pendingBotTeamCounts[index] ?? 0),
    );
    const pendingTotal = input.pendingBotTeamCounts.reduce(
        (total, count) => total + Math.max(0, count),
        0,
    );
    const effectiveContestants = Math.max(0, input.connectedPlayerCount)
        + Math.max(0, input.reservedHumanCount)
        + pendingTotal;
    const availableRoomSlots = Math.max(
        0,
        Math.min(input.maxPlayers, input.targetPlayerCount) - effectiveContestants,
    );
    const batchSize = Math.min(input.spawnPerSecond, availableRoomSlots);
    const planned: number[] = [];

    while (planned.length < batchSize) {
        let selectedIndex = 0;
        let selectedEffectiveCount = Number.POSITIVE_INFINITY;
        for (let index = 0; index < factionCount; index++) {
            const plannedForFaction = planned.filter(
                (teamId) => teamId === index + 1,
            ).length;
            const effectiveCount = effectiveBotCounts[index] + plannedForFaction;
            if (effectiveCount < selectedEffectiveCount) {
                selectedIndex = index;
                selectedEffectiveCount = effectiveCount;
            }
        }
        planned.push(selectedIndex + 1);
    }

    return planned;
}
/**
 * Best-effort lobby fill snapshot for a public auto-fill room. Omitted for
 * duel/aim-training rooms and unknown maps, which have no auto-fill policy.
 */
export function roomFillSnapshot(game: {
    mapName: string;
    teamMode: TeamMode;
    humanPlayerCount: number;
    serverBotCount: number;
    reservedHumanCount: number;
}): MatchmakingFillInfo | undefined {
    const policy = getBotAutoFillPolicy(game.mapName, game.teamMode);
    if (!policy) return undefined;
    const humanPlayers = Math.max(0, game.humanPlayerCount ?? 0);
    const botPlayers = Math.max(0, game.serverBotCount ?? 0);
    return {
        humanPlayers,
        botPlayers,
        totalPlayers: humanPlayers + botPlayers,
        targetPlayers: policy.targetPlayerCount,
        reservedPlayers: Math.max(0, game.reservedHumanCount ?? 0),
    };
}

/** Window after a room's first human joins during which auto-fill joins faster. */
export const EARLY_FILL_ACCELERATION_WINDOW_MS = 15_000;
/** Fastest join interval used during the early-fill window. */
export const EARLY_FILL_ACCELERATED_INTERVAL_MS = 800;

/**
 * Join cadence for a room while its first human is still waiting. During the
 * first few seconds the room feels empty, so bots connect at up to ~800 ms
 * apart; after the window the configured cadence (usually 2 s) takes over.
 */
export function accelerateEarlyFillIntervalMs(
    baseJoinIntervalMs: number,
    firstHumanAgeMs: number,
    windowMs = EARLY_FILL_ACCELERATION_WINDOW_MS,
): number {
    const base = Math.max(500, Math.min(60_000, Math.round(baseJoinIntervalMs) || 2000));
    if (!Number.isFinite(firstHumanAgeMs) || firstHumanAgeMs >= windowMs) return base;
    return Math.max(500, Math.min(base, EARLY_FILL_ACCELERATED_INTERVAL_MS));
}
