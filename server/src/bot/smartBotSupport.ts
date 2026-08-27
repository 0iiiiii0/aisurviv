// 从 smartBot.ts 拆出的支持代码：类型定义、纯函数助手、ObjectPool、SquadCoordinator。
// 由拆分脚本生成（2026-08-05），逻辑与拆分前完全一致。
import { isDuelMapName } from "../../../shared/defs/duelMapNames.ts";
import { RawGameObjectDefs as GameObjectDefs } from "../../../shared/defs/gameObjectDefs.ts";
import { EmotesDefs } from "../../../shared/defs/gameObjects/emoteDefs.ts";
import { MeleeDefs } from "../../../shared/defs/gameObjects/meleeDefs.ts";
import { OutfitDefs } from "../../../shared/defs/gameObjects/outfitDefs.ts";
import { UnlockDefs } from "../../../shared/defs/gameObjects/unlockDefs.ts";
import { RawMapObjectDefs as MapObjectDefs } from "../../../shared/defs/mapObjectDefs.ts";
import { GameConfig, type Input, TeamMode } from "../../../shared/gameConfig.ts";
import * as net from "../../../shared/net/net.ts";
import { type ObjectData, type ObjectsPartialData, ObjectType } from "../../../shared/net/objectSerializeFns.ts";
import { collider } from "../../../shared/utils/collider.ts";
import { util } from "../../../shared/utils/util.ts";
import { v2, type Vec2 } from "../../../shared/utils/v2.ts";
import { Config as ServerConfig } from "../config.ts";
import { type ConcealmentZone, type HiddenContact } from "./concealmentIntelligence.ts";
import { type BotState } from "./decisionBrain.ts";
import { DIFFICULTY_PROFILES, type DifficultyName, type DifficultyProfile } from "./difficultyProfiles.ts";
import {
    type DuelAdrenalinePolicy,
    type DuelModeSetting,
    normalizeDuelAdrenalinePolicy,
    normalizeDuelModeSetting,
} from "./duelStrategy.ts";
import { FactionCoordinator } from "./factionStrategy.ts";
import {
    type ForbiddenContextSnapshot,
    type ForbiddenObstacleSnapshot,
    isForbiddenContextResponse,
} from "./forbiddenCombat.ts";
import { integratedWeaponTierScore, isUtilityOnlyWeapon } from "./integratedLogicSpec.ts";
import { type MapPhase } from "./mapStrategy.ts";
import { type SpecialFactionRole } from "./specialRoleStrategy.ts";
import { resolveProjectileGunBallistics } from "./weaponBallistics.ts";

export type BotRole = "leader" | "assault" | "support" | "scout";
export type AnyDef = Record<string, any>;
export type AnyObjectData = Record<string, any>;

export interface Config {
    address: string;
    region: string;
    gameModeIdx: number;
    botCount: number;
    botIdOffset: number;
    teamSize: number;
    autoFill: boolean;
    joinDelay: number;
    tickMs: number;
    forbiddenContextIntervalMs: number;
    cpuSoftLimit: number;
    cpuHardLimit: number;
    cpuLimitEnabled: boolean;
    difficulty: DifficultyName;
    debug: boolean;
    lootScanRange: number;
    crateScanRange: number;
    cohesionRadius: number;
    regroupDistance: number;
    reviveEnemyRange: number;
    sharedTargetMemoryMs: number;
    reservationMs: number;
    mapAi: boolean;
    expectedMapName: string;
    expectedMapSeed: number;
    expectedMapSeedSet: boolean;
    mapDebug: boolean;
    factionAi: boolean;
    factionDebug: boolean;
    factionFrontWidth: number;
    factionOrderMs: number;
    factionReportMs: number;
    factionRescueRange: number;
    factionForceMode: boolean;
    combatIntelligence: boolean;
    scopeOnlyTargets: boolean;
    projectilePrediction: boolean;
    environmentalTactics: boolean;
    suppressiveCounterfire: boolean;
    concealmentTactics: boolean;
    blindFireHiddenZones: boolean;
    concealmentDebug: boolean;
    combatDebug: boolean;
    duelMode: DuelModeSetting;
    duelAdrenalinePolicy: DuelAdrenalinePolicy;
    duelAllowThrowables: boolean;
    duelDebug: boolean;
    /** 搜打撤（普通 + 绝密）通用行为开关；普通模式 AI 仍互相敌对。 */
    extractionMode: boolean;
    /** 搜打撤·绝密模式：AI 之间不互相攻击，只把真人视为敌人。 */
    extractionSecret: boolean;
    trainingTarget: boolean;
    cratePattern: RegExp;
    reconnectMaxAttempts: number;
    reconnectBaseDelayMs: number;
    reconnectIdleTimeoutMs: number;
}

/**
 * Server rejections cannot be repaired by reopening the same join token.
 * Retrying them kept dead room workers alive for up to several minutes and was
 * especially expensive when a 50v50 batch rejected all eight sockets at once.
 */
export function isTerminalBotSocketClose(code: number, reason: string): boolean {
    if (code === 1000) return true;
    if (code !== 3000) return false;
    return !new Set([
        "host_closed",
        "server_crashed",
        "server_restart",
        "rate_limited",
    ]).has(String(reason ?? "").trim());
}

export interface GameObject {
    __id: number;
    __type: ObjectType;
    data: AnyObjectData;
}

export interface PlayerMemory {
    pos: Vec2;
    velocity: Vec2;
    acceleration: Vec2;
    layer: number;
    updatedAt: number;
    seenAt: number;
}

export interface LastSeenBlindFire {
    enemyId: number;
    aimPos: Vec2;
    layer: number;
    lostAt: number;
    expiresAt: number;
    weaponSlot: number;
}

export interface CombatCoverChoice {
    obstacle: GameObject;
    anchor: Vec2;
    leftPeek: Vec2;
    rightPeek: Vec2;
    score: number;
}

export interface TargetChoice {
    object: GameObject;
    distance: number;
    score: number;
    visible: boolean;
    onScreen: boolean;
    /** A remembered opponent is on another base floor and needs a stair route. */
    floorChangeRequired?: boolean;
    targetLayer?: number;
}

export interface EnemySearchChoice {
    enemyId: number;
    lastSeenPos: Vec2;
    targetPos: Vec2;
    /** Latest known/observed destination floor. Used only for movement routing. */
    targetLayer: number;
    floorChangeRequired: boolean;
    phase: "approach" | "room-sweep" | "area-sweep";
    buildingId?: number;
    ageMs: number;
    confidence: number;
}

export interface TacticalObjectShot {
    object: GameObject;
    aimPos: Vec2;
    distance: number;
    score: number;
    kind: "explosive" | "cover" | "ricochet";
    enemyId: number;
    enemyPos: Vec2;
    safeRadius: number;
}

export interface PerkAdaptation {
    myPerks: ReadonlySet<string>;
    enemyPerks: ReadonlySet<string>;
    enemyHasFlak: boolean;
    enemyHasExplosiveRounds: boolean;
    myHasWindwalk: boolean;
    myHasFlak: boolean;
    myHasExplosiveRounds: boolean;
}

export interface HiddenAreaAttack {
    contact: HiddenContact;
    zone: ConcealmentZone;
    aimPos: Vec2;
    distance: number;
    score: number;
    mode: "destroy-bush" | "break-roof-support" | "blind-fire" | "throw-grenade";
    targetObject: GameObject | null;
    standoffPoint: Vec2;
    minimumCenterDistance: number;
    throwableType?: "frag" | "mirv";
}

export interface LootChoice {
    object: GameObject;
    distance: number;
    score: number;
    inOpeningSweep?: boolean;
}

export interface RecentLootSource {
    pos: Vec2;
    objectType: string;
    expiresAt: number;
}

export interface CrateChoice {
    object: GameObject;
    /** Distance from the bot centre to the real transformed collider surface. */
    distance: number;
    approachPoint: Vec2;
    aimPoint: Vec2;
    score: number;
    estimatedHits: number;
    expectedValue: number;
    searchBand: "near" | "mid" | "far";
    inOpeningSweep?: boolean;
}

export interface MovementCommand {
    up: boolean;
    down: boolean;
    left: boolean;
    right: boolean;
}

export interface DecisionOutput {
    movement: MovementCommand;
    aimDir: Vec2;
    mouseLen: number;
    shootStart: boolean;
    shootHold: boolean;
    inputs: Input[];
    useItem: string;
}

import { type SpecialActionLifecycleFields } from "./specialActionLifecycle.ts";

export interface PendingSpecialAction extends SpecialActionLifecycleFields {
    kind: "flare" | "bugle" | "throw";
    weaponType: string;
    target: Vec2;
    mouseLen?: number;
    coverageTarget?: Vec2;
    trackEnemyId?: number;
    counterStrobe?: boolean;
    /** Marks a strobe thrown by the battle-royale barrage planner. */
    brBarrage?: boolean;
    strobeIndex?: number;
    strobeCount?: number;
    cookMs?: number;
    throwFlightSeconds?: number;
    throwImpactSpeed?: number;
    holdMovementDir?: Vec2;
    throwPhase?: "holding" | "released";
    throwReleaseAt?: number;
    /** First tick on which the frag/MIRV pin was actually pulled. */
    grenadePinPulledAt?: number;
    /** Throttle expensive mid-cook trajectory re-solves. */
    grenadeLastRetargetAt?: number;
    /** Set when a visible close/rushing enemy forces an early legal release. */
    grenadeEmergencyRelease?: boolean;
    throwSettleUntil?: number;
    throwEquipRequestedAt?: number;
    throwEquipRequestedFromSlot?: number;
    throwEquipRequestedFromType?: string;
    createdAt: number;
    expiresAt: number;
}

export interface NearbyRoleStats {
    allies: number;
    enemies: number;
    alliesUnderFire: number;
    injuredAllies: number;
}

export interface SpecialRoleMission {
    target: Vec2;
    holdRadius: number;
    utility: number;
    reason: string;
}

export interface SquadMemberSnapshot {
    botId: number;
    playerId: number;
    role: BotRole;
    pos: Vec2;
    layer: number;
    dir: Vec2;
    health: number;
    downed: boolean;
    dead: boolean;
    underFire: boolean;
    state: BotState;
    updatedAt: number;
}

export interface EnemyReport {
    reporterBotId: number;
    targetId: number;
    pos: Vec2;
    score: number;
    distance: number;
    visible: boolean;
    updatedAt: number;
}

export interface DownedReport {
    playerId: number;
    pos: Vec2;
    outsideGas: boolean;
    enemyDistance: number;
    updatedAt: number;
    /** True when the downed teammate is a real player, not a bot. */
    human: boolean;
}

export interface RescueAssignment {
    targetPlayerId: number;
    targetPos: Vec2;
    rescuerBotId: number;
    enemyDistance: number;
    outsideGas: boolean;
    /** True when the target is a real player; bots prioritize real teammates. */
    human: boolean;
}

export interface Reservation {
    botId: number;
    score: number;
    expiresAt: number;
}

export interface AmmoNeedReport {
    key: string;
    requesterBotId: number;
    requesterPlayerId: number;
    ammoType: string;
    pos: Vec2;
    human: boolean;
    firstObservedAt: number;
    updatedAt: number;
}

export interface AmmoShareAssignment extends AmmoNeedReport {
    distance: number;
}

export interface MedicalNeedReport {
    key: string;
    requesterBotId: number;
    requesterPlayerId: number;
    pos: Vec2;
    health: number;
    human: boolean;
    firstObservedAt: number;
    updatedAt: number;
}

export interface MedicalShareAssignment extends MedicalNeedReport {
    distance: number;
}

export interface VaultPanelChoice {
    object: GameObject;
    distance: number;
    score: number;
}

export interface AirdropTarget {
    object: GameObject;
    distance: number;
    landed: boolean;
    military: boolean;
    friendlySide: boolean;
}

export interface ContainerRoute {
    building: GameObject;
    entranceOutside: Vec2;
    entranceInside: Vec2;
    botInside: boolean;
    targetInside: boolean;
}

export const DIFFICULTIES: Record<DifficultyName, DifficultyProfile> = DIFFICULTY_PROFILES;
const envNumber = (name: string, fallback: number, min = -Infinity, max = Infinity): number => {
    const parsed = Number(process.env[name]);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
};

export const normalizeDifficultyName = (value: unknown): DifficultyName => {
    const normalized = String(value ?? "normal").toLowerCase();
    return normalized === "hard"
            || normalized === "pro"
            || normalized === "legit"
            || normalized === "forbidden"
        ? normalized
        : "normal";
};

export const difficultyFromEnv = (): DifficultyName => normalizeDifficultyName(process.env.BOT_DIFFICULTY);

export const configuredBotDifficulties = (() => {
    const raw = process.env.BOT_DIFFICULTIES;
    if (!raw) return [] as DifficultyName[];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
            ? parsed.map(normalizeDifficultyName)
            : [];
    } catch {
        return raw.split(",").map(normalizeDifficultyName);
    }
})();

export const difficultyForSlot = (slot: number): DifficultyName =>
    configuredBotDifficulties[slot] ?? difficultyFromEnv();

export const configuredThinkIntervalsByDifficulty = (() => {
    const raw = process.env.BOT_THINK_INTERVALS_BY_DIFFICULTY;
    if (!raw) return {} as Partial<Record<DifficultyName, number>>;
    try {
        const record = JSON.parse(raw) as Record<string, unknown>;
        return Object.fromEntries(
            Object.entries(record).map(([key, value]) => [
                normalizeDifficultyName(key),
                Math.max(1, Math.min(250, Math.round(Number(value) || 0))),
            ]),
        ) as Partial<Record<DifficultyName, number>>;
    } catch {
        return {} as Partial<Record<DifficultyName, number>>;
    }
})();

export const configuredBotThinkIntervals = (() => {
    const raw = process.env.BOT_THINK_INTERVALS_MS;
    if (!raw) return [] as number[];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
            ? parsed.map((value) => Math.max(1, Math.min(250, Math.round(Number(value) || 0))))
            : [];
    } catch {
        return raw.split(",").map((value) => Math.max(1, Math.min(250, Math.round(Number(value) || 0))));
    }
})();

export const thinkIntervalForSlot = (slot: number, difficulty: DifficultyName): number =>
    configuredBotThinkIntervals[slot]
        ?? configuredThinkIntervalsByDifficulty[difficulty]
        ?? DIFFICULTIES[difficulty].thinkIntervalMs;

export const customBotName = (process.env.BOT_NAME ?? "").trim().slice(0, 16);
export const forcedFactionTeamIds = (() => {
    const raw = process.env.BOT_FORCED_TEAM_IDS;
    if (!raw) return [] as number[];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
            ? parsed.map((value) => Math.max(0, Math.trunc(Number(value) || 0)))
            : [];
    } catch {
        return raw
            .split(",")
            .map((value) => Math.max(0, Math.trunc(Number(value) || 0)));
    }
})();
export const configuredGameModeIdx = envNumber("BOT_GAME_MODE", 0, 0, 255);
export const configuredPlaylist = ServerConfig.modes[configuredGameModeIdx];
export const explicitTeamSize = Number(process.env.BOT_TEAM_SIZE);
export const inferredTeamSize = isDuelMapName(configuredPlaylist?.mapName ?? "")
    ? TeamMode.Solo
    : configuredPlaylist?.teamMode ?? TeamMode.Solo;
export const resolvedTeamSize = [TeamMode.Solo, TeamMode.Duo, TeamMode.Squad].includes(explicitTeamSize as TeamMode)
    ? explicitTeamSize
    : inferredTeamSize;

export const config: Config = {
    address: process.env.BOT_SERVER ?? "http://127.0.0.1:8001",
    region: process.env.BOT_REGION ?? "local",
    gameModeIdx: configuredGameModeIdx,
    botCount: envNumber("BOT_COUNT", 8, 1, 200),
    botIdOffset: envNumber("BOT_ID_OFFSET", 0, 0, 1000000),
    teamSize: resolvedTeamSize,
    autoFill: process.env.BOT_AUTOFILL === "1" || process.env.BOT_AUTOFILL === "true",
    joinDelay: envNumber("BOT_JOIN_DELAY", 120, 0, 5000),
    tickMs: envNumber("BOT_TICK_MS", 30, 1, 250),
    forbiddenContextIntervalMs: envNumber(
        "BOT_FORBIDDEN_CONTEXT_MS",
        10,
        1,
        250,
    ),
    cpuSoftLimit: envNumber("BOT_CPU_SOFT_LIMIT", 70, 25, 92),
    cpuHardLimit: envNumber("BOT_CPU_HARD_LIMIT", 80, 45, 95),
    cpuLimitEnabled: process.env.BOT_CPU_LIMIT_ENABLED === "1"
        || process.env.BOT_CPU_LIMIT_ENABLED === "true",
    difficulty: difficultyFromEnv(),
    debug: process.env.BOT_DEBUG === "1" || process.env.BOT_DEBUG === "true",
    lootScanRange: envNumber("BOT_LOOT_RANGE", 55, 10, 160),
    crateScanRange: envNumber("BOT_CRATE_RANGE", 42, 8, 120),
    cohesionRadius: envNumber("BOT_COHESION_RADIUS", 13, 5, 40),
    regroupDistance: envNumber("BOT_REGROUP_DISTANCE", 23, 8, 80),
    reviveEnemyRange: envNumber("BOT_REVIVE_ENEMY_RANGE", 19, 6, 60),
    sharedTargetMemoryMs: envNumber("BOT_SHARED_TARGET_MS", 1800, 300, 6000),
    reservationMs: envNumber("BOT_RESERVATION_MS", 2200, 400, 10000),
    mapAi: process.env.BOT_MAP_AI !== "0" && process.env.BOT_MAP_AI !== "false",
    expectedMapName: String(process.env.BOT_EXPECTED_MAP_NAME ?? "").trim(),
    expectedMapSeed: envNumber("BOT_EXPECTED_MAP_SEED", 0, 0, 0xffffffff),
    expectedMapSeedSet: process.env.BOT_EXPECTED_MAP_SEED !== undefined,
    mapDebug: process.env.BOT_MAP_DEBUG === "1" || process.env.BOT_MAP_DEBUG === "true",
    factionAi: process.env.BOT_FACTION_AI !== "0" && process.env.BOT_FACTION_AI !== "false",
    factionDebug: process.env.BOT_FACTION_DEBUG === "1" || process.env.BOT_FACTION_DEBUG === "true",
    factionFrontWidth: envNumber("BOT_FACTION_FRONT_WIDTH", 66, 24, 180),
    factionOrderMs: envNumber("BOT_FACTION_ORDER_MS", 650, 250, 2500),
    factionReportMs: envNumber("BOT_FACTION_REPORT_MS", 2400, 700, 7000),
    factionRescueRange: envNumber("BOT_FACTION_RESCUE_RANGE", 82, 20, 180),
    factionForceMode: process.env.BOT_FACTION_FORCE === "1" || process.env.BOT_FACTION_FORCE === "true",
    combatIntelligence: process.env.BOT_COMBAT_INTELLIGENCE !== "0" && process.env.BOT_COMBAT_INTELLIGENCE !== "false",
    scopeOnlyTargets: process.env.BOT_SCOPE_ONLY_TARGETS !== "0" && process.env.BOT_SCOPE_ONLY_TARGETS !== "false",
    projectilePrediction: process.env.BOT_PROJECTILE_PREDICTION !== "0"
        && process.env.BOT_PROJECTILE_PREDICTION !== "false",
    environmentalTactics: process.env.BOT_ENVIRONMENT_TACTICS !== "0"
        && process.env.BOT_ENVIRONMENT_TACTICS !== "false",
    suppressiveCounterfire: process.env.BOT_SUPPRESSIVE_COUNTERFIRE !== "0"
        && process.env.BOT_SUPPRESSIVE_COUNTERFIRE !== "false",
    concealmentTactics: process.env.BOT_CONCEALMENT_TACTICS !== "0" && process.env.BOT_CONCEALMENT_TACTICS !== "false",
    blindFireHiddenZones: process.env.BOT_BLIND_FIRE_HIDDEN !== "0" && process.env.BOT_BLIND_FIRE_HIDDEN !== "false",
    concealmentDebug: process.env.BOT_CONCEALMENT_DEBUG === "1" || process.env.BOT_CONCEALMENT_DEBUG === "true",
    combatDebug: process.env.BOT_COMBAT_DEBUG === "1" || process.env.BOT_COMBAT_DEBUG === "true",
    duelMode: normalizeDuelModeSetting(process.env.BOT_DUEL_MODE),
    duelAdrenalinePolicy: normalizeDuelAdrenalinePolicy(
        process.env.BOT_DUEL_ADRENALINE_POLICY,
        process.env.BOT_DUEL_ADRENALINE_PROHIBITED === "1"
            || process.env.BOT_DUEL_ADRENALINE_PROHIBITED === "true",
    ),
    duelAllowThrowables: process.env.BOT_DUEL_THROWABLES !== "0" && process.env.BOT_DUEL_THROWABLES !== "false",
    duelDebug: process.env.BOT_DUEL_DEBUG === "1" || process.env.BOT_DUEL_DEBUG === "true",
    extractionMode: process.env.BOT_EXTRACTION_MODE === "1"
        || process.env.BOT_EXTRACTION_MODE === "true",
    extractionSecret: process.env.BOT_EXTRACTION_SECRET === "1"
        || process.env.BOT_EXTRACTION_SECRET === "true",
    trainingTarget: process.env.BOT_TRAINING_TARGET === "1" || process.env.BOT_TRAINING_TARGET === "true",
    cratePattern: new RegExp(
        process.env.BOT_CRATE_PATTERN
            ?? "(?:crate|chest|case|box|cache|locker|container|supply|loot)",
        "i",
    ),
    reconnectMaxAttempts: envNumber("BOT_RECONNECT_ATTEMPTS", 8, 1, 30),
    reconnectBaseDelayMs: envNumber("BOT_RECONNECT_BASE_DELAY_MS", 1500, 200, 30000),
    // 服务器高负载时房间 netSync 会被明显延迟（实测单房 tick 可到 145%，
    // 一批 bot 集体"no server packets"→ 强制重连 → 重连做全量同步 → 负载更高）。
    // 默认放宽到 45s，避免把"服务器慢"误判成"连接断开"，打断这个恶性循环。
    reconnectIdleTimeoutMs: envNumber("BOT_RECONNECT_IDLE_MS", 45000, 5000, 180000),
};

export const latestForbiddenContexts = new Map<number, ForbiddenContextSnapshot>();
process.on("message", (message: unknown) => {
    if (isForbiddenContextResponse(message)) {
        const previous = latestForbiddenContexts.get(message.botPlayerId);
        // Multi-process rooms can return authoritative snapshots out of order.
        // Never let an older IPC response replace the freshest combat context:
        // doing so makes LEGIT/HACKER briefly enter `waiting` or aim at a stale
        // position even though a newer response was already received.
        if (!previous || message.sequence >= previous.sequence) {
            latestForbiddenContexts.set(message.botPlayerId, message);
        }
    }
});

export const factionCoordinator = new FactionCoordinator({
    enabled: config.factionAi,
    debug: config.factionDebug || config.debug,
    orderRefreshMs: config.factionOrderMs,
    reportMemoryMs: config.factionReportMs,
    frontWidth: config.factionFrontWidth,
    rescueRange: config.factionRescueRange,
});

export const outfits = Object.keys(OutfitDefs).filter((type) => UnlockDefs.unlock_default.unlocks.includes(type));
export const emotes = Object.keys(EmotesDefs).filter((type) => UnlockDefs.unlock_default.unlocks.includes(type));
export const melees = Object.keys(MeleeDefs).filter((type) => UnlockDefs.unlock_default.unlocks.includes(type));

export const EMPTY_MOVEMENT = (): MovementCommand => ({
    up: false,
    down: false,
    left: false,
    right: false,
});

export const now = (): number => Date.now();
export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
/**
 * True when a weapon must be HOLD-fired: automatic and burst guns (the server
 * fires both while shootHold is held), plus auto-swing melee. Single-shot guns
 * fire on each click (shootStart) and must keep shootHold false, otherwise the
 * weapon can never fire through the burst path and the bot keeps swapping guns.
 */
export const holdToFire = (def: { type?: string; fireMode?: string; autoAttack?: boolean } | undefined): boolean =>
    Boolean(
        def
            && ((def.type === "gun"
                && (def.fireMode === "auto" || def.fireMode === "burst"))
                || def.autoAttack === true),
    );
export const effectiveCombatRetreatHealth = (
    base: number,
    specialRole: SpecialFactionRole,
    phase: MapPhase,
): number => (phase === "final" || specialRole === "last_man" ? Math.min(base, 30) : base);
export const sqr = (value: number): number => value * value;
export const lengthSq = (value: Vec2): number => sqr(value.x) + sqr(value.y);
export const length = (value: Vec2): number => Math.sqrt(lengthSq(value));
export const distanceSq = (a: Vec2, b: Vec2): number => sqr(a.x - b.x) + sqr(a.y - b.y);
export const distance = (a: Vec2, b: Vec2): number => Math.sqrt(distanceSq(a, b));
export const add = (a: Vec2, b: Vec2): Vec2 => v2.create(a.x + b.x, a.y + b.y);
export const sub = (a: Vec2, b: Vec2): Vec2 => v2.create(a.x - b.x, a.y - b.y);
export const mul = (a: Vec2, scalar: number): Vec2 => v2.create(a.x * scalar, a.y * scalar);
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const normalize = (value: Vec2, fallback = v2.create(1, 0)): Vec2 => {
    const len = length(value);
    return len > 0.0001 ? v2.create(value.x / len, value.y / len) : fallback;
};
export const perpendicular = (value: Vec2): Vec2 => v2.create(-value.y, value.x);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => v2.create(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
export const randomAngle = (): number => util.random(-Math.PI, Math.PI);
export const fromAngle = (angle: number): Vec2 => v2.create(Math.cos(angle), Math.sin(angle));
export const angleOf = (direction: Vec2): number => Math.atan2(direction.y, direction.x);
export const jitterDirection = (direction: Vec2, radians: number): Vec2 =>
    fromAngle(angleOf(direction) + util.random(-radians, radians));

export const segmentPointDistance = (a: Vec2, b: Vec2, point: Vec2): number => {
    const ab = sub(b, a);
    const denom = lengthSq(ab);
    if (denom < 0.0001) return distance(a, point);
    const t = clamp(dot(sub(point, a), ab) / denom, 0, 1);
    return distance(add(a, mul(ab, t)), point);
};

export const inputForSlot = (slot: number): Input | null => {
    switch (slot) {
        case GameConfig.WeaponSlot.Primary:
            return GameConfig.Input.EquipPrimary;
        case GameConfig.WeaponSlot.Secondary:
            return GameConfig.Input.EquipSecondary;
        case GameConfig.WeaponSlot.Melee:
            return GameConfig.Input.EquipMelee;
        case GameConfig.WeaponSlot.Throwable:
            return GameConfig.Input.EquipThrowable;
        default:
            return null;
    }
};

export const gameDef = (type: string): AnyDef | undefined => GameObjectDefs[type] as AnyDef | undefined;

/**
 * Reconstructs the same world-space obstacle collider and reflection flag used
 * by the authoritative server. Client object updates do not carry a reliable
 * `reflectBullets` bit, so name/material heuristics must never be used here.
 */
export function snapshotLocalBallisticObstacle(
    object: GameObject,
): ForbiddenObstacleSnapshot | null {
    const data = object.data;
    const pos = data.pos as Vec2 | undefined;
    const type = String(data.type ?? "");
    const definition = MapObjectDefs[type] as AnyDef | undefined;
    const rawCollision = definition?.collision as AnyDef | undefined;
    if (
        !pos
        || !definition
        || !rawCollision
        || (rawCollision.type !== collider.Type.Circle && rawCollision.type !== collider.Type.Aabb)
    ) {
        return null;
    }

    const transformed = collider.transform(
        rawCollision as any,
        pos,
        (Number(data.ori ?? data.orientation ?? 0) % 4) * Math.PI * 0.5,
        Math.max(0.05, Number(data.scale ?? 1)),
    );
    const maxHealth = Math.max(1, Number(data.maxHealth ?? definition.health ?? 1));
    const healthT = Math.max(0, Math.min(1, Number(data.healthT ?? 1)));
    const doorOpen = Boolean(data.isDoor && data.door?.open);

    return {
        id: object.__id,
        type,
        pos: v2.create(pos.x, pos.y),
        layer: Number(data.layer ?? 0),
        height: Math.max(0, Number(data.height ?? definition.height ?? 2)),
        health: Math.max(0, Number(data.health ?? maxHealth * healthT)),
        maxHealth,
        healthT,
        dead: Boolean(data.dead),
        collidable: !doorOpen && data.collidable !== false && definition.collidable !== false,
        destructible: definition.destructible !== false,
        armorPlated: Boolean(definition.armorPlated),
        stonePlated: Boolean(definition.stonePlated),
        reflectBullets: Boolean(definition.reflectBullets),
        // Environmental ricochet planning deliberately excludes the separate
        // explosive-prop tactic. This snapshot is only a ballistic blocker.
        explosionType: "",
        explosionRadius: 0,
        collider: transformed.type === collider.Type.Circle
            ? {
                type: 0,
                pos: v2.create(transformed.pos.x, transformed.pos.y),
                rad: transformed.rad,
            }
            : {
                type: 1,
                min: v2.create(transformed.min.x, transformed.min.y),
                max: v2.create(transformed.max.x, transformed.max.y),
            },
    };
}

export const getDefLevel = (type: unknown): number => {
    const normalized = String(type ?? "");
    const def = gameDef(normalized);
    if (typeof def?.level === "number") return def.level;
    const match = normalized.match(/(?:0|_|-)?([1-9])$/);
    return match ? Number(match[1]) : 0;
};

export const getBulletDef = (gunType: string): AnyDef | undefined => {
    const gun = gameDef(gunType);
    const bullet = gun?.bulletType ? gameDef(gun.bulletType) : undefined;
    const projectile = resolveProjectileGunBallistics(gunType);
    if (!projectile) return bullet;
    return {
        ...bullet,
        type: "bullet",
        damage: projectile.damage,
        obstacleDamage: projectile.obstacleDamage,
        speed: projectile.speed,
        distance: projectile.range,
        onHit: projectile.onHit,
    } as AnyDef;
};

export const gunDamage = (gunType: string): number => {
    const gun = gameDef(gunType);
    const bullet = getBulletDef(gunType);
    const raw = Number(bullet?.damage ?? bullet?.damageMin ?? 20);
    return raw * Math.max(1, Number(gun?.bulletCount ?? 1));
};

export const gunSpeed = (gunType: string): number => {
    const bullet = getBulletDef(gunType);
    return Math.max(20, Number(bullet?.speed ?? bullet?.velocity ?? 90));
};

export const gunRange = (gunType: string): number => {
    const gun = gameDef(gunType);
    const bullet = getBulletDef(gunType);
    const explicit = Number(bullet?.distance ?? bullet?.range ?? gun?.range ?? 0);
    if (explicit > 0) return explicit;
    const speed = gunSpeed(gunType);
    const lifetime = Number(bullet?.maxDistanceTime ?? bullet?.lifetime ?? 0.85);
    return clamp(speed * lifetime, 18, 150);
};

export const isPrecisionSniperWeapon = (gunType: string): boolean => {
    const gun = gameDef(gunType);
    const bullet = getBulletDef(gunType);
    if (gun?.type !== "gun" || !bullet) return false;
    return (
        gun.fireMode === "single"
        && Number(gun.bulletCount ?? 1) === 1
        && Number(bullet.distance ?? 0) >= 180
        && !gun.isLauncher
    );
};

export const coverThreatForWeapon = (
    gunType: string,
): { obstacleDamagePerShot: number; fireDelaySeconds: number } | null => {
    const gun = gameDef(gunType);
    const bullet = getBulletDef(gunType);
    if (gun?.type !== "gun" || !bullet) return null;
    return {
        obstacleDamagePerShot: Math.max(0, Number(bullet.damage ?? 0))
            * Math.max(0, Number(bullet.obstacleDamage ?? 1))
            * Math.max(1, Number(gun.bulletCount ?? 1)),
        fireDelaySeconds: Math.max(0.035, Number(gun.fireDelay ?? 0.25)),
    };
};

export const gunScore = (gunType: string, desiredDistance = 35): number => {
    const gun = gameDef(gunType);
    if (!gun || gun.type !== "gun") return -1000;
    const damage = gunDamage(gunType);
    const fireDelay = Math.max(0.035, Number(gun.fireDelay ?? 0.25));
    const dps = damage / fireDelay;
    const spread = Number(gun.shotSpread ?? 5) + Number(gun.moveSpread ?? 5) * 0.35;
    const range = gunRange(gunType);
    const rangeFit = 1 - clamp(Math.abs(range - desiredDistance * 1.45) / 130, 0, 0.75);
    const quality = Number(gun.quality ?? 0);
    const launcherPenalty = gun.isLauncher ? 22 : 0;
    const tierScore = integratedWeaponTierScore(gunType, String(gun.name ?? ""));
    const utilityPenalty = isUtilityOnlyWeapon(gunType, String(gun.name ?? "")) ? 70 : 0;
    return (
        dps * 0.08
        + damage * 0.6
        + range * 0.22
        + rangeFit * 30
        - spread * 1.1
        + quality * 3
        - launcherPenalty
        + tierScore * 0.55
        - utilityPenalty
    );
};

export const meleeScore = (type: string): number => {
    const def = gameDef(type);
    if (!def || def.type !== "melee") return -1000;
    return Number(def.obstacleDamage ?? def.damage ?? 20) * 1.3 + Number(def.damage ?? 20);
};

/** One immutable/topology-heavy world layer shared by every bot in a worker. */
export class SharedStaticObjectPool {
    readonly idToObj: Record<number, GameObject> = {};
    revision = 0;
}

const isSharedWorldType = (type: ObjectType): boolean =>
    type === ObjectType.Obstacle
    || type === ObjectType.Building
    || type === ObjectType.Structure;

export class ObjectPool {
    readonly idToObj: Record<number, GameObject> = {};
    private readonly sharedStatic?: SharedStaticObjectPool;
    private allValuesCache: GameObject[] | undefined;
    private readonly typeValuesCache = new Map<ObjectType, GameObject[]>();
    private cachedSharedRevision = -1;

    constructor(sharedStatic?: SharedStaticObjectPool) {
        this.sharedStatic = sharedStatic;
    }

    private invalidateValues(): void {
        this.allValuesCache = undefined;
        this.typeValuesCache.clear();
    }

    private ensureSharedRevision(): void {
        const revision = this.sharedStatic?.revision ?? -1;
        if (revision === this.cachedSharedRevision) return;
        this.cachedSharedRevision = revision;
        this.invalidateValues();
    }

    getObjById(id: number): GameObject | undefined {
        return this.idToObj[id] ?? this.sharedStatic?.idToObj[id];
    }

    getTypeById(id: number, stream: net.BitStream): ObjectType {
        const object = this.getObjById(id);
        if (!object) {
            if (config.debug) {
                console.error("[bot] getTypeById missing object", {
                    id,
                    knownIds: Object.keys(this.idToObj).length
                        + Object.keys(this.sharedStatic?.idToObj ?? {}).length,
                    stream: stream.view.view,
                });
            }
            return ObjectType.Invalid;
        }
        return object.__type;
    }

    m_getTypeById(id: number, stream: net.BitStream): ObjectType {
        return this.getTypeById(id, stream);
    }

    updateObjFull<Type extends ObjectType>(
        type: Type,
        id: number,
        data: ObjectData<Type>,
    ): GameObject {
        const storage = this.sharedStatic && isSharedWorldType(type)
            ? this.sharedStatic.idToObj
            : this.idToObj;
        let object = storage[id];
        const previousType = object?.__type;
        if (!object) {
            object = { __id: id, __type: type, data: {} };
            storage[id] = object;
            if (storage === this.sharedStatic?.idToObj) this.sharedStatic.revision++;
        }
        object.__type = type;
        // Preserve the shared data object and update it in place. During a
        // 60-bot coordinator startup the same several-thousand static objects
        // are decoded once per socket; allocating a replacement object for
        // every duplicate produced hundreds of thousands of short-lived
        // objects and a severe full-GC spike.
        Object.assign(object.data, data as AnyObjectData);
        delete object.data.partialStream;
        delete object.data.fullStream;
        if (previousType === undefined || previousType !== type) {
            if (storage === this.sharedStatic?.idToObj) this.sharedStatic.revision++;
            this.invalidateValues();
        }
        return object;
    }

    updateObjPart<Type extends ObjectType>(
        id: number,
        data: ObjectsPartialData[Type],
    ): void {
        const object = this.getObjById(id);
        if (!object) {
            if (config.debug) console.warn("[bot] partial update for missing object", id);
            return;
        }
        // Important: copy the value of each field. The original stress test copied
        // the entire `data` object into every field, corrupting pos/dir/scale.
        Object.assign(object.data, data as AnyObjectData);
        delete object.data.partialStream;
    }

    deleteObj(id: number): void {
        if (this.idToObj[id]) {
            delete this.idToObj[id];
            this.invalidateValues();
        }
        // Shared topology objects are retained. A per-client delObj means
        // "left this viewport", not that the authoritative world object died.
    }

    clear(): void {
        for (const id of Object.keys(this.idToObj)) delete this.idToObj[Number(id)];
        this.invalidateValues();
    }

    values(type?: ObjectType): GameObject[] {
        this.ensureSharedRevision();
        if (!this.allValuesCache) {
            this.allValuesCache = this.sharedStatic
                ? [
                    ...Object.values(this.sharedStatic.idToObj),
                    ...Object.values(this.idToObj),
                ]
                : Object.values(this.idToObj);
        }
        if (type === undefined) return this.allValuesCache;
        let values = this.typeValuesCache.get(type);
        if (!values) {
            values = this.allValuesCache.filter((obj) => obj.__type === type);
            this.typeValuesCache.set(type, values);
        }
        return values;
    }
}

export class SquadCoordinator {
    readonly id: number;
    readonly expectedSize: number;

    private readonly members = new Map<number, SquadMemberSnapshot>();
    private readonly enemyReports = new Map<number, Map<number, EnemyReport>>();
    private readonly downedReports = new Map<number, DownedReport>();
    private readonly lootReservations = new Map<number, Reservation>();
    private readonly crateReservations = new Map<number, Reservation>();
    private readonly ammoNeeds = new Map<string, AmmoNeedReport>();
    private readonly ammoShareReservations = new Map<string, Reservation>();
    private readonly medicalNeeds = new Map<string, MedicalNeedReport>();
    private readonly medicalShareReservations = new Map<string, Reservation>();
    private readonly memberFloorState = new Map<
        number,
        {
            stableBase: number | null;
            candidateBase: number | null;
            candidateSince: number;
            transitioning: boolean;
        }
    >();

    private currentTargetId = 0;
    private targetLockUntil = 0;

    constructor(id: number, expectedSize: number) {
        this.id = id;
        this.expectedSize = expectedSize;
    }

    roleForSlot(slot: number): BotRole {
        if (slot === 0) return "leader";
        if (this.expectedSize === 2) return "support";
        if (slot === 1) return "assault";
        if (slot === 2) return "support";
        return "scout";
    }

    updateMember(snapshot: SquadMemberSnapshot): void {
        const rawLayer = Number(snapshot.layer) || 0;
        const base = util.toGroundLayer(rawLayer);
        const onStairs = (rawLayer & 0x2) !== 0;
        const previousFloor = this.memberFloorState.get(snapshot.botId);
        if (!previousFloor) {
            this.memberFloorState.set(snapshot.botId, {
                stableBase: onStairs ? null : base,
                candidateBase: onStairs ? null : base,
                candidateSince: snapshot.updatedAt,
                transitioning: onStairs,
            });
        } else if (onStairs) {
            previousFloor.candidateBase = null;
            previousFloor.candidateSince = snapshot.updatedAt;
            previousFloor.transitioning = true;
        } else {
            if (previousFloor.candidateBase !== base) {
                previousFloor.candidateBase = base;
                previousFloor.candidateSince = snapshot.updatedAt;
                if (previousFloor.stableBase !== base) {
                    previousFloor.transitioning = true;
                }
            }
            if (
                previousFloor.transitioning
                && snapshot.updatedAt - previousFloor.candidateSince >= 400
            ) {
                previousFloor.stableBase = base;
                previousFloor.transitioning = false;
            } else if (!previousFloor.transitioning) {
                previousFloor.stableBase = base;
            }
        }
        this.members.set(snapshot.botId, {
            ...snapshot,
            pos: v2.create(snapshot.pos.x, snapshot.pos.y),
            dir: v2.create(snapshot.dir.x, snapshot.dir.y),
        });
    }

    removeMember(botId: number): void {
        this.members.delete(botId);
        this.memberFloorState.delete(botId);
        for (const [id, reservation] of this.lootReservations) {
            if (reservation.botId === botId) this.lootReservations.delete(id);
        }
        for (const [id, reservation] of this.crateReservations) {
            if (reservation.botId === botId) this.crateReservations.delete(id);
        }
        for (const reports of this.enemyReports.values()) reports.delete(botId);
        this.ammoNeeds.delete(`bot:${botId}`);
        this.medicalNeeds.delete(`bot:${botId}`);
        for (const [key, reservation] of this.ammoShareReservations) {
            if (reservation.botId === botId) this.ammoShareReservations.delete(key);
        }
        for (const [key, reservation] of this.medicalShareReservations) {
            if (reservation.botId === botId) this.medicalShareReservations.delete(key);
        }
    }

    private activeMembers(timestamp: number): SquadMemberSnapshot[] {
        return [...this.members.values()].filter(
            (member) => timestamp - member.updatedAt <= 1800 && !member.dead,
        );
    }

    private getLeader(timestamp: number): SquadMemberSnapshot | null {
        const active = this.activeMembers(timestamp).filter((member) => !member.downed);
        return (
            active.find((member) => member.role === "leader")
                ?? active.sort((a, b) => a.botId - b.botId)[0]
                ?? null
        );
    }

    getLayeredFormationTarget(
        botId: number,
        timestamp: number,
    ): { pos: Vec2; layer: number } | null {
        const member = this.members.get(botId);
        const leader = this.getLeader(timestamp);
        if (!member || !leader || member.botId === leader.botId) return null;
        const leaderFloor = this.memberFloorState.get(leader.botId);
        // Raw layer 2/3 is only a transient half of a stair. Pause formation
        // orders until the leader has remained on a real 0/1 floor for 400ms;
        // otherwise followers reverse direction as the base bit flips mid-step.
        if (!leaderFloor || leaderFloor.transitioning || leaderFloor.stableBase === null) {
            return null;
        }

        const forward = lengthSq(leader.dir) > 0.05 ? normalize(leader.dir) : v2.create(1, 0);
        const side = perpendicular(forward);
        let forwardOffset = -2.5;
        let sideOffset = 0;

        switch (member.role) {
            case "assault":
                forwardOffset = 2.5;
                sideOffset = 3.4;
                break;
            case "support":
                forwardOffset = -3.4;
                sideOffset = -2.8;
                break;
            case "scout":
                forwardOffset = 5.2;
                sideOffset = -3.8;
                break;
            default:
                break;
        }

        if (this.expectedSize === 2) {
            forwardOffset = -2.8;
            sideOffset = -2.2;
        }

        return {
            pos: add(leader.pos, add(mul(forward, forwardOffset), mul(side, sideOffset))),
            layer: leaderFloor.stableBase,
        };
    }

    getFormationTarget(botId: number, timestamp: number): Vec2 | null {
        const member = this.members.get(botId);
        const layered = this.getLayeredFormationTarget(botId, timestamp);
        if (!member || !layered) return null;
        // A two-dimensional cohesion point must never pull a bunker member
        // toward a ground-floor leader through an arbitrary wall/stair. The
        // caller can use getLayeredFormationTarget for explicit stair routing.
        if (util.toGroundLayer(member.layer) !== util.toGroundLayer(layered.layer)) {
            return null;
        }
        return layered.pos;
    }

    getNearestLivingMember(botId: number, timestamp: number): SquadMemberSnapshot | null {
        const self = this.members.get(botId);
        if (!self) return null;
        let best: SquadMemberSnapshot | null = null;
        let bestDistance = Infinity;
        for (const member of this.activeMembers(timestamp)) {
            if (member.botId === botId || member.downed) continue;
            const dist = distance(self.pos, member.pos);
            if (dist < bestDistance) {
                best = member;
                bestDistance = dist;
            }
        }
        return best;
    }

    reportEnemy(report: EnemyReport): void {
        let reports = this.enemyReports.get(report.targetId);
        if (!reports) {
            reports = new Map<number, EnemyReport>();
            this.enemyReports.set(report.targetId, reports);
        }
        reports.set(report.reporterBotId, {
            ...report,
            pos: v2.create(report.pos.x, report.pos.y),
        });
    }

    getSharedTargetId(timestamp: number): number {
        for (const [targetId, reports] of this.enemyReports) {
            for (const [botId, report] of reports) {
                if (timestamp - report.updatedAt > config.sharedTargetMemoryMs) reports.delete(botId);
            }
            if (reports.size === 0) this.enemyReports.delete(targetId);
        }

        if (
            this.currentTargetId
            && timestamp < this.targetLockUntil
            && this.enemyReports.has(this.currentTargetId)
        ) {
            return this.currentTargetId;
        }

        let bestTarget = 0;
        let bestScore = -Infinity;
        for (const [targetId, reports] of this.enemyReports) {
            let score = 0;
            let reporters = 0;
            let visibleReports = 0;
            for (const report of reports.values()) {
                score = Math.max(score, report.score);
                reporters += 1;
                if (report.visible) visibleReports += 1;
            }
            score += Math.max(0, reporters - 1) * 24 + visibleReports * 10;
            if (score > bestScore) {
                bestScore = score;
                bestTarget = targetId;
            }
        }

        this.currentTargetId = bestTarget;
        this.targetLockUntil = bestTarget ? timestamp + 900 : 0;
        return bestTarget;
    }

    private reserve(
        reservations: Map<number, Reservation>,
        objectId: number,
        botId: number,
        score: number,
        timestamp: number,
    ): boolean {
        const current = reservations.get(objectId);
        if (
            !current
            || current.expiresAt <= timestamp
            || current.botId === botId
            || score > current.score + 45
        ) {
            reservations.set(objectId, {
                botId,
                score,
                expiresAt: timestamp + config.reservationMs,
            });
            return true;
        }
        return false;
    }

    reserveLoot(objectId: number, botId: number, score: number, timestamp: number): boolean {
        return this.reserve(this.lootReservations, objectId, botId, score, timestamp);
    }

    reserveCrate(objectId: number, botId: number, score: number, timestamp: number): boolean {
        return this.reserve(this.crateReservations, objectId, botId, score, timestamp);
    }

    releaseLoot(objectId: number, botId: number): void {
        if (this.lootReservations.get(objectId)?.botId === botId) {
            this.lootReservations.delete(objectId);
        }
    }

    releaseCrate(objectId: number, botId: number): void {
        if (this.crateReservations.get(objectId)?.botId === botId) {
            this.crateReservations.delete(objectId);
        }
    }

    reportBotAmmoNeed(
        botId: number,
        playerId: number,
        ammoType: string | null,
        pos: Vec2,
        timestamp: number,
    ): void {
        const key = `bot:${botId}`;
        if (!ammoType) {
            this.ammoNeeds.delete(key);
            this.ammoShareReservations.delete(key);
            return;
        }
        const previous = this.ammoNeeds.get(key);
        this.ammoNeeds.set(key, {
            key,
            requesterBotId: botId,
            requesterPlayerId: playerId,
            ammoType,
            pos: v2.create(pos.x, pos.y),
            human: false,
            firstObservedAt: previous?.firstObservedAt ?? timestamp,
            updatedAt: timestamp,
        });
    }

    reportHumanAmmoRequest(
        playerId: number,
        ammoType: string,
        pos: Vec2,
        timestamp: number,
    ): void {
        const key = `human:${playerId}:${ammoType}`;
        const previous = this.ammoNeeds.get(key);
        this.ammoNeeds.set(key, {
            key,
            requesterBotId: 0,
            requesterPlayerId: playerId,
            ammoType,
            pos: v2.create(pos.x, pos.y),
            human: true,
            firstObservedAt: previous?.firstObservedAt ?? timestamp,
            updatedAt: timestamp,
        });
    }

    claimAmmoShare(
        donorBotId: number,
        donorPos: Vec2,
        availableAmmoTypes: ReadonlySet<string>,
        timestamp: number,
        allowMultipleHumanDonors: boolean,
        excludedKeys: ReadonlySet<string> = new Set<string>(),
        humanOnly = false,
    ): AmmoShareAssignment | null {
        for (const [key, report] of this.ammoNeeds) {
            const maxAge = report.human ? 22_000 : 1800;
            if (timestamp - report.updatedAt > maxAge) {
                this.ammoNeeds.delete(key);
                this.ammoShareReservations.delete(key);
            }
        }
        for (const [key, reservation] of this.ammoShareReservations) {
            if (reservation.expiresAt <= timestamp) this.ammoShareReservations.delete(key);
        }

        let best: AmmoShareAssignment | null = null;
        let bestScore = -Infinity;
        for (const report of this.ammoNeeds.values()) {
            if (humanOnly && !report.human) continue;
            if (excludedKeys.has(report.key)) continue;
            if (report.requesterBotId === donorBotId) continue;
            if (!availableAmmoTypes.has(report.ammoType)) continue;
            const dist = distance(donorPos, report.pos);
            if (dist > 36) continue;
            const reservation = this.ammoShareReservations.get(report.key);
            const multipleAllowed = report.human && allowMultipleHumanDonors;
            if (reservation && reservation.botId !== donorBotId && !multipleAllowed) continue;
            const score = (report.human ? 240 : 170) - dist * 2.4
                + (timestamp - report.updatedAt < 900 ? 35 : 0);
            if (score > bestScore) {
                bestScore = score;
                best = { ...report, pos: v2.create(report.pos.x, report.pos.y), distance: dist };
            }
        }

        if (best && !(best.human && allowMultipleHumanDonors)) {
            this.ammoShareReservations.set(best.key, {
                botId: donorBotId,
                score: bestScore,
                expiresAt: timestamp + 1800,
            });
        }
        return best;
    }

    releaseAmmoShare(key: string, donorBotId: number): void {
        if (this.ammoShareReservations.get(key)?.botId === donorBotId) {
            this.ammoShareReservations.delete(key);
        }
    }

    clearAmmoNeed(key: string): void {
        this.ammoNeeds.delete(key);
        this.ammoShareReservations.delete(key);
    }

    reportBotMedicalNeed(
        botId: number,
        playerId: number,
        needsMedical: boolean,
        health: number,
        pos: Vec2,
        timestamp: number,
    ): void {
        const key = `bot:${botId}`;
        if (!needsMedical) {
            this.medicalNeeds.delete(key);
            this.medicalShareReservations.delete(key);
            return;
        }
        const previous = this.medicalNeeds.get(key);
        this.medicalNeeds.set(key, {
            key,
            requesterBotId: botId,
            requesterPlayerId: playerId,
            pos: v2.create(pos.x, pos.y),
            health: Math.max(0, Math.min(100, Number(health) || 0)),
            human: false,
            firstObservedAt: previous?.firstObservedAt ?? timestamp,
            updatedAt: timestamp,
        });
    }

    reportHumanMedicalRequest(
        playerId: number,
        health: number,
        pos: Vec2,
        timestamp: number,
    ): void {
        const key = `human:${playerId}:medical`;
        const previous = this.medicalNeeds.get(key);
        this.medicalNeeds.set(key, {
            key,
            requesterBotId: 0,
            requesterPlayerId: playerId,
            pos: v2.create(pos.x, pos.y),
            health: Math.max(0, Math.min(100, Number(health) || 0)),
            human: true,
            firstObservedAt: previous?.firstObservedAt ?? timestamp,
            updatedAt: timestamp,
        });
    }

    claimMedicalShare(
        donorBotId: number,
        donorPos: Vec2,
        timestamp: number,
        maxDistance: number,
        excludedKeys: ReadonlySet<string> = new Set<string>(),
        humanOnly = false,
    ): MedicalShareAssignment | null {
        for (const [key, report] of this.medicalNeeds) {
            const maxAge = report.human ? 22_000 : 1800;
            if (timestamp - report.updatedAt > maxAge) {
                this.medicalNeeds.delete(key);
                this.medicalShareReservations.delete(key);
            }
        }
        for (const [key, reservation] of this.medicalShareReservations) {
            if (reservation.expiresAt <= timestamp) this.medicalShareReservations.delete(key);
        }

        let best: MedicalShareAssignment | null = null;
        let bestScore = -Infinity;
        for (const report of this.medicalNeeds.values()) {
            if (humanOnly && !report.human) continue;
            if (excludedKeys.has(report.key) || report.requesterBotId === donorBotId) continue;
            const dist = distance(donorPos, report.pos);
            if (dist > maxDistance) continue;
            const reservation = this.medicalShareReservations.get(report.key);
            if (reservation && reservation.botId !== donorBotId) continue;
            const urgency = Math.max(0, 100 - report.health) * (report.human ? 2.25 : 1.85);
            const score = (report.human ? 280 : 185)
                + urgency
                - dist * 2.35
                + (timestamp - report.updatedAt < 900 ? 35 : 0);
            if (score <= bestScore) continue;
            bestScore = score;
            best = { ...report, pos: v2.create(report.pos.x, report.pos.y), distance: dist };
        }

        if (best) {
            this.medicalShareReservations.set(best.key, {
                botId: donorBotId,
                score: bestScore,
                expiresAt: timestamp + 2200,
            });
        }
        return best;
    }

    releaseMedicalShare(key: string, donorBotId: number): void {
        if (this.medicalShareReservations.get(key)?.botId === donorBotId) {
            this.medicalShareReservations.delete(key);
        }
    }

    clearMedicalNeed(key: string): void {
        this.medicalNeeds.delete(key);
        this.medicalShareReservations.delete(key);
    }

    reportDowned(reports: DownedReport[], timestamp: number): void {
        for (const report of reports) {
            const previous = this.downedReports.get(report.playerId);
            this.downedReports.set(report.playerId, {
                ...report,
                pos: v2.create(report.pos.x, report.pos.y),
                updatedAt: timestamp,
                enemyDistance: Math.min(previous?.enemyDistance ?? Infinity, report.enemyDistance),
            });
        }
        for (const [playerId, report] of this.downedReports) {
            if (timestamp - report.updatedAt > 1000) this.downedReports.delete(playerId);
        }
    }

    private computeRescueAssignments(timestamp: number): RescueAssignment[] {
        const members = this.activeMembers(timestamp).filter(
            (member) => !member.downed && member.health > 16,
        );
        const targets = [...this.downedReports.values()].sort((a, b) => {
            // Real players come first: a human teammate downed without a direct
            // threat is the highest-value rescue, ahead of any bot teammate.
            const priorityA = (a.human ? 160 : 0) + (a.outsideGas ? 30 : 0) + clamp(a.enemyDistance, 0, 60) * 0.4;
            const priorityB = (b.human ? 160 : 0) + (b.outsideGas ? 30 : 0) + clamp(b.enemyDistance, 0, 60) * 0.4;
            return priorityB - priorityA;
        });
        const usedBots = new Set<number>();
        const assignments: RescueAssignment[] = [];

        for (const target of targets) {
            let best: SquadMemberSnapshot | null = null;
            let bestCost = Infinity;
            for (const member of members) {
                if (usedBots.has(member.botId) || member.playerId === target.playerId) continue;
                let cost = distance(member.pos, target.pos);
                if (member.role === "support") cost -= 6;
                if (member.role === "leader") cost += 3;
                if (member.role === "scout") cost += 1.5;
                if (member.health < 45) cost += 12;
                if (member.underFire) cost += 18;
                if (cost < bestCost) {
                    best = member;
                    bestCost = cost;
                }
            }
            if (!best) continue;
            usedBots.add(best.botId);
            assignments.push({
                targetPlayerId: target.playerId,
                targetPos: target.pos,
                rescuerBotId: best.botId,
                enemyDistance: target.enemyDistance,
                outsideGas: target.outsideGas,
                human: target.human,
            });
        }
        return assignments;
    }

    getRescueFor(botId: number, timestamp: number): RescueAssignment | null {
        return this.computeRescueAssignments(timestamp).find(
            (assignment) => assignment.rescuerBotId === botId,
        ) ?? null;
    }

    getCoverOrder(botId: number, timestamp: number): RescueAssignment | null {
        const assignments = this.computeRescueAssignments(timestamp);
        const self = this.members.get(botId);
        if (!self) return null;
        let best: RescueAssignment | null = null;
        let bestDistance = Infinity;
        for (const assignment of assignments) {
            if (assignment.rescuerBotId === botId) continue;
            const dist = distance(self.pos, assignment.targetPos);
            if (dist < bestDistance) {
                best = assignment;
                bestDistance = dist;
            }
        }
        return bestDistance <= 48 ? best : null;
    }
}
