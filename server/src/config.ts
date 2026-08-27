import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../../config.ts";
import type { ConfigType as UpstreamConfigType } from "../../configType.ts";
import { MapDefs } from "../../shared/defs/mapDefs.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { util } from "../../shared/utils/util.ts";
import {
    type AiDifficultyRatios,
    type AiThinkIntervals,
    DEFAULT_AI_DIFFICULTY_RATIOS,
    DEFAULT_AI_THINK_INTERVALS,
    normalizeAiDifficultyRatios,
    normalizeAiThinkIntervals,
} from "./botDifficulty.ts";
import {
    DEFAULT_DUEL_ADRENALINE_ENABLED,
    DEFAULT_DUEL_AI_DIFFICULTY,
    DEFAULT_DUEL_AI_ENABLED,
    DEFAULT_DUEL_BOOST,
    DEFAULT_DUEL_CHEST_LEVEL,
    DEFAULT_DUEL_HELMET_LEVEL,
    DEFAULT_DUEL_SCOPE,
    DEFAULT_DUEL_THROWABLES,
    type DuelAiDifficulty,
    type DuelArmorLevel,
    type DuelScope,
    type DuelThrowables,
    normalizeDuelAiDifficulty,
    normalizeDuelArmorLevel,
    normalizeDuelBoost,
    normalizeDuelScope,
    normalizeDuelThrowables,
} from "./duelLoadout.ts";
import { DEFAULT_DUEL_WEAPONS, normalizeDuelWeapons } from "./duelWeapons.ts";
import { defaultExtractionSecretAiLoadouts } from "./extractionLoadouts.ts";

const isProduction = process.env["NODE_ENV"] === "production";
export const serverConfigPath = isProduction ? "../../" : "";

export interface ModeConfig {
    /** Stable identifier for persisting mode state across catalogue changes. */
    modeId: string;
    mapName: keyof typeof MapDefs;
    /**
     * Human-readable map/playlist name used by the administration dashboard.
     * Team size is appended by the dashboard and client where appropriate.
     */
    title: string;
    teamMode: TeamMode;
    enabled: boolean;
    /** 僵尸模式标志：使用 main 地图 + 大批量低占用近战僵尸。 */
    zombieMode?: boolean;
}

export interface BotAutoFillModeOverride {
    joinIntervalMs: number;
    /** Deprecated V15-V49 fields accepted during migration and removed on save. */
    botLimit?: number;
    targetPlayerCount?: number;
}

export interface BotAutoFillConfig {
    enabled: boolean;
    /** Public rooms do not become autonomous AI matches before a human reserves or joins. */
    requireHumanBeforeFill: boolean;
    /** Unified AI join interval shared by every auto-filled room. */
    defaultJoinIntervalMs: number;
    /** Solo public rooms humans + AI fill target. */
    soloTargetPlayerCount: number;
    /** Duo public rooms humans + AI fill target. */
    duoTargetPlayerCount: number;
    /** Squad public rooms humans + AI fill target. */
    squadTargetPlayerCount: number;
    /** 50v50 humans + AI fill target; even-numbered bots split across factions. */
    factionTargetPlayerCount: number;
    /** 绝密搜打撤独立补齐目标（真人+AI），按队形分别配置；
     *  0 = 不单独设置，跟随普通模式同队形目标。 */
    extractionSecretSoloTargetPlayerCount: number;
    extractionSecretDuoTargetPlayerCount: number;
    extractionSecretSquadTargetPlayerCount: number;
    /** Expected distribution for automatically spawned public-room AI. */
    difficultyRatios: AiDifficultyRatios;
    /** Per-difficulty decision intervals. Smaller values are more responsive and more CPU intensive. */
    thinkIntervalsMs: AiThinkIntervals;
    /** 搜打撤补员每批 AI 数（0 = 按机器自适应：
     *  空闲内存 ≥ 10GB → 1 个 AI/进程（多用并行）；
     *  内存紧张 → 合并进程省内存，避免 V8 Zone OOM）。 */
    extractionReplenishBatch: number;
    /** 普通搜打撤补员 AI 的决策间隔（ms）。搜打撤 AI 以搜索/跑毒/战斗为主，
     *  不需要竞技模式那么高的反应频率，放宽间隔可明显降低 CPU，缓解高 ping/
     *  卡顿；绝密模式强 AI 仍走各自难度默认频率。 */
    extractionThinkIntervalMs: number;
    /** 并发 bot worker 进程的全局上限：防止搜打撤补员风暴 fork 过多
     *  node 子进程，把机器内存/提交压力打爆（V8 "Fatal process out of
     *  memory: Zone"）。达到上限时暂停补员，等已有 worker 退出后再补。 */
    maxBotWorkers: number;
    /** 50v50 only: optional remote smart-bot compute node. Other playlists
     * continue using local worker processes. */
    remoteFactionWorker: {
        enabled: boolean;
        /** Control endpoint exposed by remote-bot-worker (for example http://192.168.1.50:9100). */
        controlUrl: string;
        /** Shared bearer token; keep this identical to remote-bot-worker/worker-config.json. */
        token: string;
        /** Game-server hostname/IP reachable from the compute node, without the per-room port. */
        advertisedGameHost: string;
        /** Fall back to a local smartBot process when the remote node cannot accept a job. */
        fallbackToLocal: boolean;
        requestTimeoutMs: number;
    };
    /** Deprecated V15-V34 alias retained for older configuration files. */
    highBudgetIntervalMs: number;
    modeOverrides: Record<string, BotAutoFillModeOverride>;
}

export interface SandevistanConfig {
    /** Time multiplier applied to the activating player's own actions
     * (movement / shooting / healing / reload) while active. */
    playerTimeScale: number;
    /** Time multiplier applied to the whole match while active: other
     * players, AI, bullets, gas, throwables and map interactions. */
    worldTimeScale: number;
}

/** 搜打撤·绝密模式：AI 套用最终幸存者（last_man）+ 无限子弹 + 不互攻，
 *  特殊掉落规则（武器降级 / 随机能力 / 高物资掉率）。 */
export interface ExtractionSecretConfig {
    /** 开关：开启后搜打撤对局按绝密规则运行。 */
    enabled: boolean;
    /** 绝密 AI 难度（后台可调）。 */
    aiDifficulty: DuelAiDifficulty;
    /** 绝密 AI 满激素且不掉（可后台开关）。 */
    immortalBoost: boolean;
}

/** 僵尸模式：大批量低占用近战僵尸追逐玩家。 */
export interface ZombieModeConfig {
    /** 开局初始僵尸数量。 */
    initialCount: number;
    /** 每次补充的僵尸数量。 */
    replenishCount: number;
    /** 补充间隔（秒）。 */
    replenishIntervalSec: number;
    /** 胜利所需坚持时长（秒）。 */
    winTimeSec: number;
    /** 自爆变种僵尸概率。 */
    selfDestructChance: number;
}

/** 搜打撤 Boss（高级资源点守卫）单条掉落配置。 */
export interface ExtractionBossDropEntry {
    /** 掉落物品类型（枪械/护甲/弹药/能力等，如 "awc"、"chest03"、"8xscope"）。 */
    type: string;
    /** 掉落数量。 */
    count: number;
    /** 掉率百分比 0-100。 */
    weight: number;
}

/** 搜打撤·高级资源点 Boss（仅绝密搜打撤生效）。 */
export interface ExtractionBossConfig {
    /** 开关：关闭后不生成 Boss。 */
    enabled: boolean;
    /** Boss 血量（独立于玩家基础血量）。 */
    maxHealth: number;
    /** 每局 Boss 数量。 */
    count: number;
    /** Boss 初始巡逻半径；首次受到有效伤害后解除范围限制。 */
    patrolRadius: number;
    /** Boss 自带默认天赋（3 个）：始终生效，但不单独掉落
     * （只有随机天赋恰好抽到其中某个时才作为随机天赋掉落）。 */
    bossDefaultPerks: string[];
    /** Boss 天赋池：生成时随机赋予一个并佩戴（属性生效），死亡后必定掉落。 */
    bossPerks: string[];
    /** Boss 武器（独立于掉落表）：死亡后必定掉落，用 1v1 武器选择面板配置。 */
    weapons: Array<{ type: string; count: number }>;
    /** 每个地图的 Boss 固定位置（地图名 -> 坐标列表）；缺省回退到自动生成。 */
    bossPositions: Record<string, Array<{ x: number; y: number }>>;
    /** 死亡掉落表（按权重随机）。 */
    dropItems: ExtractionBossDropEntry[];
    /** Boss 装备（护甲/倍镜）：helmet/chest/backpack/scope；缺省用默认模型。 */
    armor: {
        helmet?: string;
        chest?: string;
        backpack?: string;
        scope?: string;
    };
    /** 全局 Boss 护卫（小弟）总数（按对局人数：单人/双人/四人）：
     *  总配额会平分到本局各 Boss；护卫在 Boss 附近独立索敌。 */
    minions: {
        solo: number;
        duo: number;
        squad: number;
    };
}

/** 搜打撤 AI 追杀玩家的数量（各模式单独配置；AI 死亡后空位给下一个 AI）。 */
export interface ExtractionHunterModeConfig {
    /** 单人（TeamMode.Solo）同时追杀玩家的 AI 上限。 */
    solo: number;
    /** 双人（TeamMode.Duo）同时追杀玩家的 AI 上限。 */
    duo: number;
    /** 四人（TeamMode.Squad）同时追杀玩家的 AI 上限。 */
    squad: number;
}

export interface ExtractionHunterConfig {
    /** 普通搜打撤：按单人/双人/四人分别设置。 */
    normal: ExtractionHunterModeConfig;
    /** 绝密搜打撤：按单人/双人/四人分别设置。 */
    secret: ExtractionHunterModeConfig;
}

/** 单个物品的价格覆盖（后台可改；缺省时用商店内置默认定价）。 */
export interface ShopItemPriceOverride {
    /** 是否允许购买；缺省时沿用商品默认规则。 */
    buyEnabled?: boolean;
    /** 是否允许出售；缺省时沿用商品默认规则。 */
    sellEnabled?: boolean;
    /** 买入价（金币）；null 兼容旧配置，表示不允许购买。 */
    buy?: number | null;
    /** 卖出价（金币）；null 兼容旧配置，表示不允许出售。 */
    sell?: number | null;
}

/** 商店（搜打撤经济系统）配置。 */
export interface ShopConfig {
    /** 逐物品价格覆盖。 */
    prices: Record<string, ShopItemPriceOverride>;
    /** 一次性技能（仅限一局）定价。 */
    oneTimePerkPrice: number;
    /** 禁购的一次性技能类型。 */
    oneTimePerkBanned: string[];
}

export interface ExtractionAiLoadoutPresetConfig {
    name: string;
    weight: number;
    loadout: {
        guns: string[];
        ammo: Record<string, number>;
        consumables: Record<string, number>;
        armor: {
            helmet?: string;
            chest?: string;
            backpack?: string;
            scope?: string;
        };
    };
}

export interface RoomPlayerLimitsConfig {
    /** Shared room capacity for all public solo playlists. */
    solo: number;
    /** Shared room capacity for all public duo playlists. */
    duo: number;
    /** Shared room capacity for all public squad playlists. */
    squad: number;
    /** Shared room capacity for the 50v50 (faction) playlist. */
    faction: number;
}

export interface AnnouncementConfig {
    heading: string;
    date: string;
    title: string;
    body: string;
    updatedAt: string;
}

export interface LiveAnnouncementConfig {
    message: string;
    publishedAt: string;
    expiresAt: string;
}

function battleRoyaleModes(
    mapName: keyof typeof MapDefs,
    title: string,
    enabled = false,
): ModeConfig[] {
    const suffixes = ["solo", "duo", "squad"];
    return [TeamMode.Solo, TeamMode.Duo, TeamMode.Squad].map((teamMode, i) => ({
        modeId: `${mapName}_${suffixes[i]}`,
        mapName,
        title,
        teamMode,
        enabled,
    }));
}

/**
 * Complete playlist catalogue supported by the map definitions in this build.
 *
 * Each entry carries a stable `modeId` so installed mode state survives additions
 * or reorderings of the catalogue array. The legacy index-based lookup is still
 * accepted by the admin API but the canonical persistence key is now `modeId`.
 */
const DefaultModes: ModeConfig[] = [
    ...battleRoyaleModes("main", "Normal", true),
    {
        modeId: "zombie_solo",
        mapName: "zombie",
        title: "僵尸模式",
        teamMode: TeamMode.Solo,
        zombieMode: true,
        enabled: true,
    },
    {
        modeId: "zombie_duo",
        mapName: "zombie",
        title: "僵尸模式",
        teamMode: TeamMode.Duo,
        zombieMode: true,
        enabled: true,
    },
    {
        modeId: "zombie_squad",
        mapName: "zombie",
        title: "僵尸模式",
        teamMode: TeamMode.Squad,
        zombieMode: true,
        enabled: true,
    },
    {
        modeId: "duel_solo",
        mapName: "duel",
        title: "1v1",
        teamMode: TeamMode.Solo,
        enabled: false,
    },
    ...battleRoyaleModes("potato", "Potato"),

    ...battleRoyaleModes("desert", "Desert"),
    {
        modeId: "faction_squad",
        mapName: "faction",
        title: "50v50",
        teamMode: TeamMode.Squad,
        enabled: false,
    },
    ...battleRoyaleModes("woods", "Woods"),
    ...battleRoyaleModes("savannah", "Savannah"),
    ...battleRoyaleModes("cobalt", "Cobalt"),
    ...battleRoyaleModes("turkey", "Turkey"),
    ...battleRoyaleModes("halloween", "Halloween"),
    ...battleRoyaleModes("snow", "Snow"),

    ...battleRoyaleModes("main_spring", "Normal 春季"),
    ...battleRoyaleModes("main_summer", "Normal 夏季"),

    {
        modeId: "sandevistan_solo",
        mapName: "sandevistan",
        title: "斯安威斯坦",
        teamMode: TeamMode.Solo,
        enabled: false,
    },
    ...battleRoyaleModes("extraction", "搜打撤", true),
    ...battleRoyaleModes("extraction_secret", "绝密搜打撤"),
    ...battleRoyaleModes("potato_spring", "Potato 春季"),
    ...battleRoyaleModes("woods_snow", "Woods 雪地"),
    ...battleRoyaleModes("woods_spring", "Woods 春季"),
    ...battleRoyaleModes("woods_summer", "Woods 夏季"),
];

function getToday(): string {
    const daysOfWeek = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
    ];

    return daysOfWeek[new Date().getDay()];
}

function getMapsOfTheDay(): Array<{
    mapName: keyof typeof MapDefs;
    teamMode: TeamMode;
    enabled: boolean;
}> {
    const maps: Array<{
        mapName: keyof typeof MapDefs;
        teamMode: TeamMode;
        enabled: boolean;
    }> = [];

    switch (getToday()) {
        case "sunday": {
            maps.push({ mapName: "main", teamMode: 1, enabled: true });
            maps.push({ mapName: "main", teamMode: 2, enabled: true });
            maps.push({ mapName: "faction", teamMode: 4, enabled: true });
            break;
        }
        case "monday": {
            maps.push({ mapName: "cobalt", teamMode: 1, enabled: true });
            maps.push({ mapName: "main", teamMode: 2, enabled: true });
            maps.push({ mapName: "cobalt", teamMode: 4, enabled: true });
            break;
        }
        case "tuesday": {
            maps.push({ mapName: "turkey", teamMode: 1, enabled: true });
            maps.push({ mapName: "turkey", teamMode: 2, enabled: true });
            maps.push({ mapName: "main", teamMode: 4, enabled: true });
            break;
        }
        case "wednesday": {
            maps.push({ mapName: "woods", teamMode: 1, enabled: true });
            maps.push({ mapName: "main", teamMode: 2, enabled: true });
            maps.push({ mapName: "main", teamMode: 4, enabled: true });
            break;
        }
        case "thursday": {
            maps.push({ mapName: "desert", teamMode: 1, enabled: true });
            maps.push({ mapName: "main", teamMode: 2, enabled: true });
            maps.push({ mapName: "desert", teamMode: 4, enabled: true });
            break;
        }
        case "friday": {
            maps.push({ mapName: "main", teamMode: 1, enabled: true });
            maps.push({ mapName: "potato", teamMode: 2, enabled: true });
            maps.push({ mapName: "potato", teamMode: 4, enabled: true });
            break;
        }
        case "saturday": {
            maps.push({ mapName: "savannah", teamMode: 1, enabled: true });
            maps.push({ mapName: "savannah", teamMode: 2, enabled: true });
            maps.push({ mapName: "main", teamMode: 4, enabled: true });
            break;
        }
        default: {
            maps.push({ mapName: "main", teamMode: 1, enabled: true });
            maps.push({ mapName: "main", teamMode: 2, enabled: true });
            maps.push({ mapName: "main", teamMode: 4, enabled: true });
            break;
        }
    }

    return maps;
}

/**
 * Default config
 */
export const Config = {
    devServer: {
        host: "127.0.0.1",
        port: 8001,
    },

    apiServer: {
        host: "0.0.0.0",
        port: 8000,
    },

    gameServer: {
        host: "0.0.0.0",
        port: 8001,
        apiServerUrl: "http://127.0.0.1:8000",
    },

    apiKey: "Kongregate Sucks Filled With Bastards",

    admin: {
        enabled: true,
        /** Login sessions expire after this many hours. */
        sessionHours: 12,
        /** Stored outside the web root. V20 stores the administrator password in plain text. */
        credentialFile: "survivio-admin-auth.json",
    },

    botAutoFill: {
        enabled: true,
        requireHumanBeforeFill: true,
        defaultJoinIntervalMs: 2000,
        extractionThinkIntervalMs: 150,
        soloTargetPlayerCount: 20,
        duoTargetPlayerCount: 20,
        squadTargetPlayerCount: 20,
        factionTargetPlayerCount: 40,
        extractionSecretSoloTargetPlayerCount: 0,
        extractionSecretDuoTargetPlayerCount: 0,
        extractionSecretSquadTargetPlayerCount: 0,
        difficultyRatios: { ...DEFAULT_AI_DIFFICULTY_RATIOS },
        thinkIntervalsMs: { ...DEFAULT_AI_THINK_INTERVALS },
        extractionReplenishBatch: 0,
        // One worker controls up to eight bots. Sixteen concurrent workers are
        // enough for the configured rosters while bounding V8 heap/CPU growth
        // when several public rooms coexist.
        maxBotWorkers: 16,
        remoteFactionWorker: {
            enabled: false,
            controlUrl: "http://127.0.0.1:9100",
            token: "",
            advertisedGameHost: "",
            fallbackToLocal: true,
            requestTimeoutMs: 2500,
        },
        highBudgetIntervalMs: DEFAULT_AI_THINK_INTERVALS.legit,
        modeOverrides: {},
    },

    extractionSecret: {
        enabled: false,
        aiDifficulty: "normal",
        immortalBoost: true,
    },

    /** 僵尸模式：大批量低占用近战僵尸追逐玩家。 */
    zombie: {
        initialCount: 40,
        replenishCount: 20,
        replenishIntervalSec: 120,
        winTimeSec: 360,
        selfDestructChance: 0.05,
    },

    extractionBoss: {
        enabled: true,
        maxHealth: 600,
        count: 2,
        patrolRadius: 24,
        bossDefaultPerks: ["steelskin", "flak_jacket", "gotw"],
        bossPerks: [
            "steelskin",
            "flak_jacket",
            "gotw",
            "firepower",
            "ap_rounds",
            "lifeline",
            "takedown",
            "chambered",
            "explosive",
        ],
        weapons: [],
        // 缺省按地标动态定位：标准地图 = 豪宅一个 + 赭红俱乐部底下泳池一个
        // （随地图种子找实际地标对象，不再用固定坐标，避免位置漂移）。
        bossPositions: {},
        dropItems: [
            { type: "awc", count: 1, weight: 30 },
            { type: "8xscope", count: 1, weight: 40 },
            { type: "chest03", count: 1, weight: 40 },
            { type: "helmet03", count: 1, weight: 40 },
            { type: "m4a1", count: 1, weight: 35 },
            { type: "frag", count: 3, weight: 60 },
            { type: "bandage", count: 5, weight: 80 },
        ],
        armor: {},
        // 全局护卫总数（不是每个 Boss）：单人 0、双人 2、四人 3。
        minions: { solo: 0, duo: 2, squad: 3 },
    },

    extractionHunters: {
        normal: { solo: 4, duo: 4, squad: 4 },
        secret: { solo: 6, duo: 6, squad: 6 },
    },

    /** 搜打撤 AI（普通/绝密）死亡时额外掉落的物品表（后台可配；基础装备仍掉）。 */
    extractionAiDropItems: [],

    shop: {
        prices: {},
        /** 一次性技能（仅限一局）定价。 */
        oneTimePerkPrice: 3000,
        /** 禁购的一次性技能（AI 不掉落的技能，无法在局内重复获取，不允许购买）。 */
        oneTimePerkBanned: ["scavenger", "scavenger_adv"],
    },

    roomPlayerLimits: {
        solo: 20,
        duo: 20,
        squad: 20,
        faction: 40,
    },

    sandevistan: {
        playerTimeScale: 0.5,
        worldTimeScale: 0.1,
    },

    extractionAiLoadouts: [
        {
            name: "标准突击",
            weight: 40,
            loadout: {
                guns: ["ak47"],
                ammo: { "762mm": 90 },
                consumables: { bandage: 4, soda: 1 },
                armor: { backpack: "backpack01", helmet: "helmet01", chest: "chest01" },
            },
        },
        {
            name: "轻装游走",
            weight: 25,
            loadout: {
                guns: ["mp5"],
                ammo: { "9mm": 90 },
                consumables: { bandage: 3 },
                armor: { backpack: "backpack01" },
            },
        },
        {
            name: "重装火力",
            weight: 20,
            loadout: {
                guns: ["m249"],
                ammo: { "556mm": 120 },
                consumables: { bandage: 5, healthkit: 1, soda: 2 },
                armor: {
                    backpack: "backpack02",
                    helmet: "helmet02",
                    chest: "chest02",
                    scope: "2xscope",
                },
            },
        },
        {
            name: "精确射手",
            weight: 15,
            loadout: {
                guns: ["mosin"],
                ammo: { "762mm": 40 },
                consumables: { bandage: 2, painkiller: 1 },
                armor: { backpack: "backpack01", scope: "4xscope" },
            },
        },
    ],

    /** 绝密模式 AI 默认配装：与普通搜打撤 AI 完全独立（后台可调）。 */
    extractionSecretAiLoadouts: defaultExtractionSecretAiLoadouts,

    network: {
        ipv6: true,
        ipv6Host: "::",
    },

    duel: {
        weapons: [...DEFAULT_DUEL_WEAPONS] as [string, string],
        adrenalineEnabled: DEFAULT_DUEL_ADRENALINE_ENABLED,
        boost: DEFAULT_DUEL_BOOST,
        helmetLevel: DEFAULT_DUEL_HELMET_LEVEL as DuelArmorLevel,
        chestLevel: DEFAULT_DUEL_CHEST_LEVEL as DuelArmorLevel,
        scope: DEFAULT_DUEL_SCOPE as DuelScope,
        throwables: { ...DEFAULT_DUEL_THROWABLES },
        aiEnabled: DEFAULT_DUEL_AI_ENABLED,
        aiDifficulty: DEFAULT_DUEL_AI_DIFFICULTY,
        roomModeEnabled: true,
    },

    announcement: {
        heading: "What's New!",
        date: "December 30, 2019",
        title: "Free Fryer",
        body:
            "PARMA's FSTMS division is pleased to introduce the next generation in starch-based modern warfare: the spud gun.\n\nOfficially designated the SMG-8 (Spud Missile Generator), the spud gun uses a proprietary breech-to-muzzle heat expander to fry and propel wedge-shaped projectiles at tremendous speeds.",
        updatedAt: "2019-12-30T00:00:00.000Z",
    },

    liveAnnouncement: {
        message: "",
        publishedAt: "",
        expiresAt: "",
    },

    modes: DefaultModes.map((mode) => ({ ...mode })), // getMapsOfTheDay(),

    regions: {},

    debug: {
        spawnMode: "default",
    },

    rateLimitsEnabled: isProduction,

    client: {
        AIP_ID: undefined,
        AIP_PLACEMENT_ID: undefined,
        theme: "main",
    },

    thisRegion: "local",

    gameTps: 60,
    netSyncTps: 20,

    processMode: isProduction ? "multi" : "single",

    perfLogging: {
        enabled: true,
        time: 10,
    },

    /** 服务端卡顿判定阈值（毫秒）：单帧间隔 ≥ 此值视为本局发生服务端引发的
     *  卡顿，触发搜打撤"卡顿局阵亡归还带入装备"补偿。仅搜打撤模式生效。 */
    serverLagThresholdMs: 250,
    /** Only deaths close to a server incident are auto-refunded. */
    serverLagCompensationWindowMs: 30_000,
    serverCpuPressurePercent: 95,
    serverCpuPressureDurationMs: 2_000,
    serverSystemFreeMemoryRatio: 0.03,
    serverProcessRssLimitMb: 2_048,
    serverMemoryPressureDurationMs: 2_000,
    serverNetworkBackpressureBytes: 512 * 1024,
    serverNetworkBackpressureDurationMs: 1_500,

    gameConfig: {},
} as unknown as ConfigType;

// 0.3.12 owns transport, database, OAuth and runtime defaults. The legacy
// adapter contributes only custom gameplay/admin fields and remains readable
// from survivio-config.json for an in-place upgrade.
const { modes: _upstreamModes, ...upstreamConfig } = getConfig(
    isProduction,
    serverConfigPath,
);
util.mergeDeep(Config, upstreamConfig);

// Both source execution (server/src) and Rolldown output (server/dist) are
// exactly two levels below the project root.
export const configPath = path.resolve(import.meta.dirname, "../..");

/**
 * 玩家数据独立目录：仓库（survivio-stash.json）与玩家账号
 * （survivio-player-accounts.json）放在这里，与代码/配置分离，
 * 避免全量更新或误删项目根目录时把玩家数据一起清掉。
 *
 * 可用环境变量 SURVIV_DATA_DIR 指定到项目外（例如 D:\surviv-data），
 * 未设置时默认 <项目根>/server-data/。
 */
export const dataPath = (() => {
    const envDir = process.env.SURVIV_DATA_DIR;
    const resolved = envDir && envDir.trim()
        ? path.isAbsolute(envDir.trim())
            ? envDir.trim()
            : path.join(configPath, envDir.trim())
        : path.join(configPath, "server-data");
    try {
        fs.mkdirSync(resolved, { recursive: true });
    } catch {
        // 目录创建失败时仍返回路径，后续读写会报错以便定位。
    }
    return resolved;
})();

export function getServerConfigFilePath(fileName: string): string {
    return path.join(configPath, fileName);
}

/** 玩家数据文件路径（独立数据目录）。 */
export function getServerDataFilePath(fileName: string): string {
    return path.join(dataPath, fileName);
}

/** 持久化失败（磁盘写入/rename 失败、数据损坏等）。API 应返回 503。 */
export class PersistenceError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PersistenceError";
    }
}

/**
 * 升级迁移：若独立数据目录缺少该文件而项目根目录仍存在旧文件，
 * 自动复制过去（例如从旧版本升级到“数据独立目录”版本时保留玩家数据）。
 */
export function migrateServerDataFile(fileName: string): void {
    const dest = getServerDataFilePath(fileName);
    if (fs.existsSync(dest)) return;
    const legacy = getServerConfigFilePath(fileName);
    if (!fs.existsSync(legacy)) return;
    try {
        fs.mkdirSync(dataPath, { recursive: true });
        fs.copyFileSync(legacy, dest);
        console.log(`[data] migrated ${fileName} -> ${dest}`);
    } catch (error) {
        console.error(`[data] failed to migrate ${fileName}:`, error);
    }
}

// 启动时检测重复数据副本：若项目根目录仍存在旧玩家数据文件，提示管理员
// 收敛到单一权威目录（SURVIV_DATA_DIR 或 server-data/），避免分叉。
{
    const RUNTIME_DATA_FILES = [
        "survivio-stash.json",
        "survivio-player-accounts.json",
        "survivio-admin-auth.json",
    ];
    const duplicates = RUNTIME_DATA_FILES.filter((file) => {
        const dataFile = path.join(dataPath, file);
        const legacyFile = path.join(configPath, file);
        return fs.existsSync(dataFile) && fs.existsSync(legacyFile);
    });
    if (duplicates.length > 0) {
        console.warn(
            `[data] 检测到重复数据副本：项目根目录存在 ${duplicates.join(", ")}，`
                + `同时数据目录 ${dataPath} 也存在。请只保留一个权威目录（建议 `
                + `SURVIV_DATA_DIR 或 server-data/），项目根目录的旧副本仅作迁移备份。`,
        );
    }
}

export function migrateLegacyBotAutoFillConfig(botConfig: Record<string, unknown>): void {
    const splitKeys = [
        "soloTargetPlayerCount",
        "duoTargetPlayerCount",
        "squadTargetPlayerCount",
        "factionTargetPlayerCount",
    ];
    const hasSplit = splitKeys.filter((key) => key in botConfig).length >= 2
        || splitKeys.some((key) => Number(botConfig[key]) > 0);
    if (hasSplit) {
        // Already the four-target format; just consume a stale shared field.
        delete botConfig.targetPlayerCount;
        return;
    }
    const legacyTargets: number[] = [];
    const existingTarget = Number(botConfig.targetPlayerCount);
    if (Number.isFinite(existingTarget) && existingTarget > 0) {
        // A V80 shared target seeds every mode. Ordinary modes clamp to the
        // room maximum in the policy layer, so the behaviour is preserved.
        legacyTargets.push(existingTarget);
    } else {
        const ordinaryLimit = Number(botConfig.ordinaryBotLimit);
        if (Number.isFinite(ordinaryLimit)) legacyTargets.push(ordinaryLimit);
        const overrides = botConfig.modeOverrides;
        if (overrides && typeof overrides === "object" && !Array.isArray(overrides)) {
            for (const value of Object.values(overrides as Record<string, unknown>)) {
                if (!value || typeof value !== "object" || Array.isArray(value)) continue;
                const override = value as Record<string, unknown>;
                for (const candidate of [override.targetPlayerCount, override.botLimit]) {
                    const parsed = Number(candidate);
                    if (Number.isFinite(parsed)) legacyTargets.push(parsed);
                }
            }
        }
    }
    if (legacyTargets.length > 0) {
        const target = Math.min(
            100,
            Math.max(1, Math.floor(Math.max(...legacyTargets))),
        );
        for (const key of splitKeys) {
            botConfig[key] = target;
        }
    }
    delete botConfig.targetPlayerCount;
}

function loadConfig(fileName: string, create?: boolean) {
    const filePath = path.join(configPath, fileName);

    let loaded = false;
    if (fs.existsSync(filePath)) {
        const localConfig = JSON.parse(fs.readFileSync(filePath).toString());
        if (
            localConfig?.duel
            && typeof localConfig.duel === "object"
            && !Array.isArray(localConfig.duel)
            && "armorLevel" in localConfig.duel
        ) {
            localConfig.duel.helmetLevel ??= localConfig.duel.armorLevel;
            localConfig.duel.chestLevel ??= localConfig.duel.armorLevel;
            delete localConfig.duel.armorLevel;
        }
        // Migrate V15-V49 bot limits before merging with V50 defaults. The
        // default shared target already exists on Config, so migration must
        // inspect the raw local file first or legacy values would be hidden.
        if (
            localConfig?.botAutoFill
            && typeof localConfig.botAutoFill === "object"
            && !Array.isArray(localConfig.botAutoFill)
        ) {
            migrateLegacyBotAutoFillConfig(
                localConfig.botAutoFill as Record<string, unknown>,
            );
        }
        util.mergeDeep(Config, localConfig);
        loaded = true;
    } else if (create) {
        console.log("Config file doesn't exist... creating");
        fs.writeFileSync(filePath, JSON.stringify({}, null, 2));
    }

    util.mergeDeep(GameConfig, Config.gameConfig);
    return loaded;
}

// try loading old config file first for backwards compatibility
if (!loadConfig("survivio-config.json")) {
    loadConfig("survivio-config.json", true);
}

const liveConfigFilePath = path.join(configPath, "survivio-config.json");

function configFileSignature(filePath: string): string {
    try {
        const stat = fs.statSync(filePath);
        return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
    } catch {
        return "missing";
    }
}

// API 进程和游戏/后台进程各自持有 Config 内存副本。记住启动时文件
// 版本，以便后台在另一进程保存商店开关后，API 可在下次请求即时重载。
let liveShopConfigSignature = configFileSignature(liveConfigFilePath);

/**
 * 从共享配置文件同步最新商店策略。只在文件变化时解析 JSON，无变化时
 * 仅一次 stat；读到写入中间状态时保留旧策略，下次请求继续重试。
 */
export function refreshShopConfigFromDisk(): void {
    const signature = configFileSignature(liveConfigFilePath);
    if (signature === liveShopConfigSignature) return;
    try {
        const parsed = JSON.parse(fs.readFileSync(liveConfigFilePath, "utf8")) as {
            shop?: Partial<ShopConfig>;
        };
        const shop = parsed?.shop;
        if (!shop || typeof shop !== "object" || Array.isArray(shop)) return;
        Config.shop.prices = shop.prices && typeof shop.prices === "object"
                && !Array.isArray(shop.prices)
            ? shop.prices
            : {};
        if (Number.isFinite(Number(shop.oneTimePerkPrice))) {
            Config.shop.oneTimePerkPrice = Math.max(
                0,
                Math.floor(Number(shop.oneTimePerkPrice)),
            );
        }
        if (Array.isArray(shop.oneTimePerkBanned)) {
            Config.shop.oneTimePerkBanned = shop.oneTimePerkBanned.map(String);
        }
        liveShopConfigSignature = signature;
    } catch {
        // 保存过程中的短暂不完整文件不能放开交易；保留旧值并等下次重试。
    }
}

const LEGACY_DEFAULT_API_KEY = "Kongregate Sucks Filled With Bastards";
if (Config.apiKey && Config.apiKey !== LEGACY_DEFAULT_API_KEY) {
    Config.secrets.SURVEV_API_KEY = Config.apiKey;
} else {
    Config.apiKey = Config.secrets.SURVEV_API_KEY;
}

if (Config.thisRegion && Config.thisRegion !== "local") {
    Config.gameServer.thisRegion = Config.thisRegion;
} else {
    Config.thisRegion = Config.gameServer.thisRegion;
}

if (Config.client.theme !== "main" && Config.client.theme in MapDefs) {
    Config.clientTheme = Config.client.theme as keyof typeof MapDefs;
} else {
    const upstreamTheme = String(Config.clientTheme);
    const legacyThemes: Array<typeof Config.client.theme> = [
        "main",
        "easter",
        "halloween",
        "faction",
        "snow",
        "spring",
    ];
    if (legacyThemes.includes(upstreamTheme as typeof Config.client.theme)) {
        Config.client.theme = upstreamTheme as typeof Config.client.theme;
    }
}

function normalizeModeCatalogue(): void {
    const configuredModes = Config.modes as ModeConfig[];
    const configuredById = new Map(
        configuredModes
            .filter((mode) => mode.modeId)
            .map((mode) => [mode.modeId, mode]),
    );
    const configuredByKey = new Map(
        configuredModes.map((mode) => [
            `${mode.mapName}:${mode.teamMode}`,
            mode,
        ]),
    );

    Config.modes = DefaultModes.map((defaultMode) => {
        const configured = configuredById.get(defaultMode.modeId)
            ?? configuredByKey.get(
                `${defaultMode.mapName}:${defaultMode.teamMode}`,
            );
        return {
            ...defaultMode,
            enabled: defaultMode.mapName === "extraction"
                ? true
                : defaultMode.mapName === "extraction_secret"
                ? configured?.enabled ?? (Config.extractionSecret.enabled === true)
                : configured?.enabled ?? defaultMode.enabled,
        };
    }) as typeof Config.modes;
}

// Older configuration files contain only the modes that existed when they
// were written. Expand them against the current catalogue without resetting
// any existing public/closed switches.
normalizeModeCatalogue();
Config.duel.weapons = normalizeDuelWeapons(Config.duel.weapons);
Config.duel.adrenalineEnabled = Config.duel.adrenalineEnabled !== false;
Config.duel.boost = normalizeDuelBoost(Config.duel.boost);
Config.duel.aiEnabled = Config.duel.aiEnabled === true;
Config.duel.aiDifficulty = normalizeDuelAiDifficulty(Config.duel.aiDifficulty);
Config.duel.roomModeEnabled = Config.duel.roomModeEnabled !== false;
Config.duel.helmetLevel = normalizeDuelArmorLevel(Config.duel.helmetLevel);
Config.duel.chestLevel = normalizeDuelArmorLevel(Config.duel.chestLevel);
Config.duel.scope = normalizeDuelScope(Config.duel.scope);
Config.duel.throwables = normalizeDuelThrowables(Config.duel.throwables);
Config.admin.enabled = Config.admin.enabled !== false;
Config.admin.sessionHours = Math.min(168, Math.max(1, Number(Config.admin.sessionHours) || 12));
Config.admin.credentialFile = typeof Config.admin.credentialFile === "string" && Config.admin.credentialFile.trim()
    ? path.basename(Config.admin.credentialFile.trim())
    : "survivio-admin-auth.json";
Config.botAutoFill.enabled = Config.botAutoFill.enabled !== false;
Config.botAutoFill.requireHumanBeforeFill = Config.botAutoFill.requireHumanBeforeFill !== false;
Config.botAutoFill.defaultJoinIntervalMs = Math.min(
    60000,
    Math.max(500, Math.round(Number(Config.botAutoFill.defaultJoinIntervalMs) || 2000)),
);
Config.botAutoFill.difficultyRatios = normalizeAiDifficultyRatios(
    Config.botAutoFill.difficultyRatios,
);
const legacyHighBudgetInterval = Math.min(
    250,
    Math.max(
        1,
        Math.round(Number(Config.botAutoFill.highBudgetIntervalMs) || DEFAULT_AI_THINK_INTERVALS.legit),
    ),
);
Config.botAutoFill.thinkIntervalsMs = normalizeAiThinkIntervals(
    Config.botAutoFill.thinkIntervalsMs ?? {
        ...DEFAULT_AI_THINK_INTERVALS,
        legit: legacyHighBudgetInterval,
        forbidden: legacyHighBudgetInterval,
    },
);
Config.botAutoFill.highBudgetIntervalMs = Config.botAutoFill.thinkIntervalsMs.legit;
Config.botAutoFill.extractionThinkIntervalMs = Math.min(
    250,
    Math.max(
        1,
        Math.round(Number(Config.botAutoFill.extractionThinkIntervalMs) || 150),
    ),
);
Config.botAutoFill.maxBotWorkers = Math.min(
    64,
    Math.max(1, Math.floor(Number(Config.botAutoFill.maxBotWorkers) || 16)),
);
{
    const remote = Config.botAutoFill.remoteFactionWorker ?? {
        enabled: false,
        controlUrl: "http://127.0.0.1:9100",
        token: "",
        advertisedGameHost: "",
        fallbackToLocal: true,
        requestTimeoutMs: 2500,
    };
    const envControlUrl = process.env.SURVIV_FACTION_REMOTE_WORKER_URL?.trim();
    const envToken = process.env.SURVIV_FACTION_REMOTE_WORKER_TOKEN?.trim();
    const envGameHost = process.env.SURVIV_FACTION_REMOTE_GAME_HOST?.trim();
    const envEnabled = process.env.SURVIV_FACTION_REMOTE_WORKER_ENABLED?.trim().toLowerCase();
    const envFallback = process.env.SURVIV_FACTION_REMOTE_FALLBACK_LOCAL?.trim().toLowerCase();
    Config.botAutoFill.remoteFactionWorker = {
        enabled: envEnabled
            ? envEnabled === "1" || envEnabled === "true"
            : remote.enabled === true,
        controlUrl: envControlUrl || String(remote.controlUrl ?? "http://127.0.0.1:9100").trim(),
        token: envToken || String(remote.token ?? "").trim(),
        advertisedGameHost: envGameHost || String(remote.advertisedGameHost ?? "").trim(),
        fallbackToLocal: envFallback
            ? envFallback !== "0" && envFallback !== "false"
            : remote.fallbackToLocal !== false,
        requestTimeoutMs: Math.min(
            10_000,
            Math.max(500, Math.round(Number(remote.requestTimeoutMs) || 2500)),
        ),
    };
}
Config.extractionSecret.enabled = Config.extractionSecret.enabled !== false;
Config.extractionSecret.immortalBoost = Config.extractionSecret.immortalBoost !== false;
Config.extractionSecret.aiDifficulty = normalizeDuelAiDifficulty(
    Config.extractionSecret.aiDifficulty,
);
if (!Config.shop.prices || typeof Config.shop.prices !== "object") {
    Config.shop.prices = {};
}
if (!Config.botAutoFill.modeOverrides || typeof Config.botAutoFill.modeOverrides !== "object") {
    Config.botAutoFill.modeOverrides = {};
}

function normalizeRoomLimit(value: unknown, fallback: number, teamSize: number): number {
    const raw = Math.min(100, Math.max(teamSize, Math.floor(Number(value) || fallback)));
    return Math.max(teamSize, raw - (raw % teamSize));
}
Config.roomPlayerLimits = {
    solo: normalizeRoomLimit(Config.roomPlayerLimits?.solo, 20, 1),
    duo: normalizeRoomLimit(Config.roomPlayerLimits?.duo, 20, 2),
    squad: normalizeRoomLimit(Config.roomPlayerLimits?.squad, 20, 4),
    faction: Math.min(100, Math.max(2, Math.floor(Number(Config.roomPlayerLimits?.faction) || 100))),
};

function normalizeExtractionHunterMode(
    value: unknown,
    fallback: number,
): ExtractionHunterModeConfig {
    const obj = value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {};
    const clamp = (v: unknown, fb: number): number => {
        const parsed = Number(v);
        const n = Number.isFinite(parsed) ? parsed : fb;
        return Math.min(50, Math.max(0, Math.floor(n)));
    };
    // 兼容旧格式：extractionHunters.normal / secret 直接是数字。
    const mode = typeof value === "number"
        ? { solo: value, duo: value, squad: value }
        : obj;
    return {
        solo: clamp(mode.solo, fallback),
        duo: clamp(mode.duo, fallback),
        squad: clamp(mode.squad, fallback),
    };
}
Config.extractionHunters = {
    normal: normalizeExtractionHunterMode(Config.extractionHunters?.normal, 4),
    secret: normalizeExtractionHunterMode(Config.extractionHunters?.secret, 6),
};
function normalizeSandevistanScale(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed)
        ? Math.round(Math.min(1, Math.max(0.01, parsed)) * 1000) / 1000
        : fallback;
}
Config.sandevistan = {
    playerTimeScale: normalizeSandevistanScale(Config.sandevistan?.playerTimeScale, 0.5),
    worldTimeScale: normalizeSandevistanScale(Config.sandevistan?.worldTimeScale, 0.1),
};

// V15-V49 stored AI caps and per-mode fill targets. V76 split them into four
// independent targets (solo / duo / squad / 50v50); V80 briefly merged them
// into one shared target and V85 restores the four independent ones. Prefer an
// explicitly configured target; otherwise preserve the largest legacy
// target/cap so upgrading does not unexpectedly shrink populated rooms.
const legacyFillTargets = Object.values(Config.botAutoFill.modeOverrides).flatMap((override) => {
    const values = [Number(override?.targetPlayerCount), Number(override?.botLimit)];
    return values.filter(Number.isFinite).map((value) => Math.max(1, Math.floor(value)));
});
const legacyOrdinaryLimit = Number((Config.botAutoFill as unknown as { ordinaryBotLimit?: unknown }).ordinaryBotLimit);
if (Number.isFinite(legacyOrdinaryLimit)) legacyFillTargets.push(Math.max(1, Math.floor(legacyOrdinaryLimit)));
const legacyFloor = legacyFillTargets.length > 0
    ? Math.min(100, Math.max(1, Math.floor(Math.max(...legacyFillTargets))))
    : 20;
const normalizeFillTarget = (value: number | undefined, fallback: number): number =>
    Math.min(
        100,
        Math.max(1, Math.floor(Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback)),
    );
Config.botAutoFill.soloTargetPlayerCount = normalizeFillTarget(
    Config.botAutoFill.soloTargetPlayerCount,
    legacyFloor,
);
Config.botAutoFill.duoTargetPlayerCount = normalizeFillTarget(
    Config.botAutoFill.duoTargetPlayerCount,
    legacyFloor,
);
Config.botAutoFill.squadTargetPlayerCount = normalizeFillTarget(
    Config.botAutoFill.squadTargetPlayerCount,
    legacyFloor,
);
Config.botAutoFill.factionTargetPlayerCount = normalizeFillTarget(
    Config.botAutoFill.factionTargetPlayerCount,
    Config.botAutoFill.squadTargetPlayerCount,
);
delete (Config.botAutoFill as unknown as { ordinaryBotLimit?: unknown }).ordinaryBotLimit;
for (const override of Object.values(Config.botAutoFill.modeOverrides)) {
    delete override.botLimit;
    delete override.targetPlayerCount;
}

export function saveBotAutoFillConfig(): void {
    saveConfigSection("botAutoFill", Config.botAutoFill);
}

export function saveRoomPlayerLimitsConfig(): void {
    saveConfigSection("roomPlayerLimits", Config.roomPlayerLimits);
}

export function saveExtractionAiLoadouts(): void {
    saveConfigSection("extractionAiLoadouts", Config.extractionAiLoadouts);
}

export function saveExtractionSecretAiLoadouts(): void {
    saveConfigSection("extractionSecretAiLoadouts", Config.extractionSecretAiLoadouts);
}

export function saveShopConfig(): void {
    saveConfigSection("shop", Config.shop);
}

function saveConfigSection(key: string, value: unknown): void {
    const filePath = path.join(configPath, "survivio-config.json");
    let localConfig: Record<string, unknown> = {};
    if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            localConfig = parsed as Record<string, unknown>;
        }
    }
    localConfig[key] = value;
    fs.writeFileSync(filePath, `${JSON.stringify(localConfig, null, 4)}\n`, "utf8");
}

export function saveAnnouncementConfig(): void {
    const filePath = path.join(configPath, "survivio-config.json");
    let localConfig: Record<string, unknown> = {};

    if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            localConfig = parsed as Record<string, unknown>;
        }
    }

    localConfig.announcement = Config.announcement;
    fs.writeFileSync(filePath, `${JSON.stringify(localConfig, null, 4)}\n`, "utf8");
}

export function saveModeConfig(): void {
    const filePath = path.join(configPath, "survivio-config.json");
    let localConfig: Record<string, unknown> = {};

    if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            localConfig = parsed as Record<string, unknown>;
        }
    }

    localConfig.modes = Config.modes;
    fs.writeFileSync(filePath, `${JSON.stringify(localConfig, null, 4)}\n`, "utf8");
}

export function saveSandevistanConfig(): void {
    const filePath = path.join(configPath, "survivio-config.json");
    let localConfig: Record<string, unknown> = {};

    if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            localConfig = parsed as Record<string, unknown>;
        }
    }

    localConfig.sandevistan = Config.sandevistan;
    fs.writeFileSync(filePath, `${JSON.stringify(localConfig, null, 4)}\n`, "utf8");
}

export function saveExtractionSecretConfig(): void {
    const filePath = path.join(configPath, "survivio-config.json");
    let localConfig: Record<string, unknown> = {};
    if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            localConfig = parsed as Record<string, unknown>;
        }
    }
    localConfig.extractionSecret = Config.extractionSecret;
    localConfig.modes = Config.modes;
    fs.writeFileSync(filePath, `${JSON.stringify(localConfig, null, 4)}\n`, "utf8");
}

export function saveExtractionBossConfig(): void {
    saveConfigSection("extractionBoss", Config.extractionBoss);
}

export function saveExtractionHuntersConfig(): void {
    saveConfigSection("extractionHunters", Config.extractionHunters);
}

export function saveExtractionAiDropItemsConfig(): void {
    saveConfigSection("extractionAiDropItems", Config.extractionAiDropItems);
}

export function saveDuelConfig(): void {
    const filePath = path.join(configPath, "survivio-config.json");
    let localConfig: Record<string, unknown> = {};

    if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            localConfig = parsed as Record<string, unknown>;
        }
    }

    localConfig.duel = Config.duel;
    fs.writeFileSync(filePath, `${JSON.stringify(localConfig, null, 4)}\n`, "utf8");
}

type DeepPartial<T> = T extends object ? {
        [P in keyof T]?: DeepPartial<T[P]>;
    }
    : T;

export type ConfigType = Omit<UpstreamConfigType, "modes"> & {
    /** Compatibility-only integrated-server settings. */
    devServer: UpstreamConfigType["gameServer"];

    /**
     * Pre-0.3 alias. It is synchronized with secrets.SURVEV_API_KEY below.
     */
    apiKey: string;

    /**
     * Built-in game administration dashboard.
     * Production deployments should keep this disabled until a strong token is set.
     */
    admin: {
        enabled: boolean;
        sessionHours: number;
        credentialFile: string;
    };

    botAutoFill: BotAutoFillConfig;

    roomPlayerLimits: RoomPlayerLimitsConfig;

    sandevistan: SandevistanConfig;

    /** 搜打撤 AI default loadouts: multiple presets with spawn probabilities. */
    extractionAiLoadouts: ExtractionAiLoadoutPresetConfig[];
    /** 绝密模式 AI 默认配装（独立于普通搜打撤 AI）。 */
    extractionSecretAiLoadouts: ExtractionAiLoadoutPresetConfig[];
    /** 搜打撤·绝密模式配置。 */
    extractionSecret: ExtractionSecretConfig;
    /** 搜打撤 Boss（高级资源点守卫）配置。 */
    extractionBoss: ExtractionBossConfig;
    /** 僵尸模式配置。 */
    zombie: ZombieModeConfig;
    /** 搜打撤 AI 追杀玩家的数量（普通 / 绝密分别配置）。 */
    extractionHunters: ExtractionHunterConfig;
    /** 搜打撤 AI 死亡额外掉落物（后台配置）。 */
    extractionAiDropItems: ExtractionBossDropEntry[];
    /** 商店（搜打撤经济系统）配置。 */
    shop: ShopConfig;

    network: {
        ipv6: boolean;
        ipv6Host: string;
    };

    duel: {
        weapons: [string, string];
        adrenalineEnabled: boolean;
        boost: number;
        helmetLevel: DuelArmorLevel;
        chestLevel: DuelArmorLevel;
        scope: DuelScope;
        throwables: DuelThrowables;
        aiEnabled: boolean;
        aiDifficulty: DuelAiDifficulty;
        /** Enables private invite/code 1v1 rooms independently from random matchmaking. */
        roomModeEnabled: boolean;
    };

    announcement: AnnouncementConfig;

    liveAnnouncement: LiveAnnouncementConfig;

    /** Pre-0.3 alias for gameServer.thisRegion. */
    thisRegion: string;

    modes: ModeConfig[];

    /**
     * If games should all run in the same process
     * Or spawn a new process for each game
     * Defaults to single in development and multi in production
     */
    processMode: "single" | "multi";

    /**
     * Server logging
     */
    perfLogging: {
        enabled: boolean;
        /**
         * Seconds between each game performance log
         */
        time: number;
    };

    /** 服务端卡顿判定阈值（毫秒）：单帧间隔 ≥ 此值视为本局发生服务端引发的
     *  卡顿，触发搜打撤"卡顿局阵亡归还带入装备"补偿。仅搜打撤模式生效。 */
    serverLagThresholdMs: number;
    /** Recent-incident window and overload thresholds used by extraction compensation. */
    serverLagCompensationWindowMs: number;
    serverCpuPressurePercent: number;
    serverCpuPressureDurationMs: number;
    serverSystemFreeMemoryRatio: number;
    serverProcessRssLimitMb: number;
    serverMemoryPressureDurationMs: number;
    serverNetworkBackpressureBytes: number;
    serverNetworkBackpressureDurationMs: number;

    client: {
        // adin play IDs
        AIP_ID: string | undefined;
        AIP_PLACEMENT_ID: string | undefined;
        theme: "main" | "easter" | "halloween" | "faction" | "snow" | "spring";
    };

    /**
     * Game config overrides
     * @NOTE don't modify values used by client since this only applies to server
     */
    gameConfig: DeepPartial<typeof GameConfig>;
};
