import type { GroundPatch } from "../../../shared/net/mapMsg.ts";
import type { Vec2 } from "../../../shared/utils/v2.ts";

export type BotMapRole = "leader" | "assault" | "support" | "scout";
export type MapPhase = "early" | "mid" | "late" | "final";

export interface StaticMapObject {
    pos: Vec2;
    scale: number;
    type: string;
    ori: number;
}

export interface MapPlaceSnapshot {
    name: string;
    pos: Vec2;
}

export interface MapRiverSnapshot {
    width: number;
    looped: boolean;
    points: Vec2[];
}

export interface MapGroundPatchSnapshot {
    color: number;
    roughness: number;
    offsetDist: number;
    order?: number;
    useAsMapShape?: boolean;
    min: Vec2;
    max: Vec2;
}

export interface MapRuntimeSnapshot {
    mapName: string;
    seed: number;
    width: number;
    height: number;
    shoreInset: number;
    grassInset: number;
    rivers: MapRiverSnapshot[];
    places: MapPlaceSnapshot[];
    objects: StaticMapObject[];
    groundPatches: MapGroundPatchSnapshot[];
}

export type MapRuntimeInputSnapshot = Omit<MapRuntimeSnapshot, "groundPatches"> & {
    /** Current wire format uses `bound`; legacy recordings already contain min/max. */
    groundPatches: Array<MapGroundPatchSnapshot | GroundPatch>;
};

export interface MapProfile {
    id: string;
    displayName: string;
    aliases: string[];
    description: string;
    preferredRange: number;
    combatScanMultiplier: number;
    idealRangeMultiplier: number;
    aimJitterMultiplier: number;
    strafeMultiplier: number;
    lootMultiplier: number;
    crateMultiplier: number;
    healSafetyMultiplier: number;
    rotateEarly: number;
    openFieldAversion: number;
    waterAversion: number;
    riverRouting: number;
    coverPreference: number;
    buildingPreference: number;
    bunkerPreference: number;
    bridgePreference: number;
    vegetationPreference: number;
    airdropInterest: number;
    explosiveAvoidance: number;
    formationScale: number;
    rescueRiskMultiplier: number;
    lateCenterBias: number;
    aggressiveLooting: number;
    closeWeaponBias: number;
    longWeaponBias: number;
    throwableBias: number;
    specialTags: string[];
}

interface TacticalPoint {
    pos: Vec2;
    score: number;
    kind:
        | "place"
        | "building"
        | "bunker"
        | "bridge"
        | "container"
        | "cover"
        | "special"
        | "resource"
        | "spawn";
    label: string;
}

export type LootTierName =
    | "world"
    | "soviet"
    | "surviv"
    | "container"
    | "airdrop"
    | "military-airdrop"
    | "gold-airdrop"
    | "bunker"
    | "class-pod"
    | "perk-cache"
    | "event"
    | "unknown";

export interface LootSourceContext {
    tier: LootTierName;
    objectType: string;
    label: string;
    highValue: number;
    pos?: Vec2;
}

interface ClassifiedMapData {
    buildings: StaticMapObject[];
    bunkers: StaticMapObject[];
    bridges: StaticMapObject[];
    containers: StaticMapObject[];
    covers: StaticMapObject[];
    hazards: StaticMapObject[];
    vegetation: StaticMapObject[];
    specials: StaticMapObject[];
    highValue: TacticalPoint[];
    spawnClusters: TacticalPoint[];
    tacticalPoints: TacticalPoint[];
}

const DEFAULT_PROFILE: MapProfile = {
    id: "adaptive",
    displayName: "Adaptive / Custom",
    aliases: ["unknown", "custom"],
    description: "Runtime analysis fallback for custom and unknown maps.",
    preferredRange: 38,
    combatScanMultiplier: 1,
    idealRangeMultiplier: 1,
    aimJitterMultiplier: 1,
    strafeMultiplier: 1,
    lootMultiplier: 1,
    crateMultiplier: 1,
    healSafetyMultiplier: 1,
    rotateEarly: 0.5,
    openFieldAversion: 0.55,
    waterAversion: 0.8,
    riverRouting: 0.8,
    coverPreference: 0.75,
    buildingPreference: 0.8,
    bunkerPreference: 0.9,
    bridgePreference: 0.6,
    vegetationPreference: 0.45,
    airdropInterest: 0.55,
    explosiveAvoidance: 0.85,
    formationScale: 1,
    rescueRiskMultiplier: 1,
    lateCenterBias: 0.7,
    aggressiveLooting: 0.6,
    closeWeaponBias: 1,
    longWeaponBias: 1,
    throwableBias: 1,
    specialTags: ["adaptive"],
};

const profile = (
    id: string,
    displayName: string,
    description: string,
    aliases: string[],
    overrides: Partial<MapProfile>,
): MapProfile => ({
    ...DEFAULT_PROFILE,
    id,
    displayName,
    description,
    aliases: [id, ...aliases],
    ...overrides,
});

export const MAP_PROFILES: MapProfile[] = [
    profile(
        "main",
        "Normal",
        "Balanced combat with strong building and bunker rotations.",
        ["normal", "main_normal"],
        {
            buildingPreference: 1.05,
            bunkerPreference: 1.15,
            bridgePreference: 0.75,
            coverPreference: 0.85,
            specialTags: ["balanced", "buildings", "bunkers"],
        },
    ),
    profile(
        "main_spring",
        "Spring",
        "Normal-map routing with greater use of vegetation and concealed approaches.",
        ["spring", "spring_main"],
        {
            vegetationPreference: 0.9,
            coverPreference: 0.95,
            openFieldAversion: 0.62,
            buildingPreference: 1,
            specialTags: ["spring", "vegetation", "concealment"],
        },
    ),
    profile(
        "main_summer",
        "Summer",
        "Earlier shoreline rotations and longer sight-line combat.",
        ["summer", "summer_main"],
        {
            preferredRange: 44,
            combatScanMultiplier: 1.08,
            idealRangeMultiplier: 1.12,
            longWeaponBias: 1.18,
            rotateEarly: 0.66,
            waterAversion: 0.92,
            openFieldAversion: 0.7,
            specialTags: ["summer", "shoreline", "long-sight"],
        },
    ),
    profile(
        "desert",
        "Desert",
        "Open-ground survival: seek hard cover, rotate early and value long-range weapons.",
        ["desert_rain", "desert_event"],
        {
            preferredRange: 54,
            combatScanMultiplier: 1.24,
            idealRangeMultiplier: 1.35,
            aimJitterMultiplier: 0.88,
            strafeMultiplier: 1.15,
            rotateEarly: 0.9,
            openFieldAversion: 1,
            coverPreference: 1,
            buildingPreference: 1.15,
            vegetationPreference: 0.18,
            airdropInterest: 0.9,
            longWeaponBias: 1.42,
            closeWeaponBias: 0.8,
            explosiveAvoidance: 1,
            specialTags: ["open", "long-range", "airdrop", "early-rotation"],
        },
    ),
    profile(
        "faction",
        "50v50 Faction",
        "Front-line squad play with bridge control, tighter formations and high rescue priority.",
        ["50v50", "factions", "ultimate_sacrifice", "faction_ultimate"],
        {
            preferredRange: 46,
            combatScanMultiplier: 1.25,
            strafeMultiplier: 0.95,
            rotateEarly: 0.72,
            riverRouting: 1,
            bridgePreference: 1.45,
            coverPreference: 0.95,
            formationScale: 0.78,
            rescueRiskMultiplier: 1.28,
            throwableBias: 1.32,
            airdropInterest: 1.15,
            specialTags: ["faction", "frontline", "bridges", "rescue", "airdrop"],
        },
    ),
    profile(
        "halloween",
        "Halloween",
        "Shorter-range ambushes, aggressive event-container clearing and stronger explosive caution.",
        ["spooky", "halloween_event"],
        {
            preferredRange: 30,
            combatScanMultiplier: 0.92,
            idealRangeMultiplier: 0.78,
            strafeMultiplier: 1.22,
            crateMultiplier: 1.28,
            aggressiveLooting: 0.88,
            coverPreference: 1,
            vegetationPreference: 0.82,
            closeWeaponBias: 1.4,
            longWeaponBias: 0.78,
            explosiveAvoidance: 1.2,
            specialTags: ["dark", "ambush", "event-containers", "close-range"],
        },
    ),
    profile(
        "potato",
        "Potato",
        "Rapid weapon turnover, high container value and broad ammunition collection.",
        ["potato_event"],
        {
            preferredRange: 34,
            lootMultiplier: 1.24,
            crateMultiplier: 1.45,
            aggressiveLooting: 1,
            closeWeaponBias: 1.18,
            longWeaponBias: 1.08,
            throwableBias: 1.2,
            formationScale: 0.9,
            specialTags: ["potato", "weapon-turnover", "all-weapons", "containers"],
        },
    ),
    profile(
        "potato_spring",
        "Potato Spring",
        "Potato weapon turnover combined with spring concealment and cover routes.",
        ["spring_potato"],
        {
            lootMultiplier: 1.24,
            crateMultiplier: 1.42,
            aggressiveLooting: 1,
            vegetationPreference: 0.9,
            coverPreference: 0.95,
            closeWeaponBias: 1.22,
            specialTags: ["potato", "spring", "weapon-turnover", "concealment"],
        },
    ),
    profile(
        "snow",
        "Snow",
        "Longer sight lines, earlier rotations and controlled crossings over exposed terrain.",
        ["winter", "snow_event"],
        {
            preferredRange: 49,
            combatScanMultiplier: 1.18,
            idealRangeMultiplier: 1.24,
            rotateEarly: 0.84,
            openFieldAversion: 0.88,
            waterAversion: 0.55,
            coverPreference: 0.98,
            longWeaponBias: 1.3,
            closeWeaponBias: 0.88,
            specialTags: ["snow", "open", "long-range", "early-rotation"],
        },
    ),
    profile(
        "woods",
        "Woods",
        "Dense-cover fighting with short scans, close-range weapons and cover-to-cover movement.",
        ["forest", "woods_event"],
        {
            preferredRange: 25,
            combatScanMultiplier: 0.78,
            idealRangeMultiplier: 0.68,
            aimJitterMultiplier: 1.08,
            strafeMultiplier: 1.2,
            openFieldAversion: 0.45,
            coverPreference: 1.25,
            vegetationPreference: 1.35,
            buildingPreference: 0.72,
            closeWeaponBias: 1.55,
            longWeaponBias: 0.58,
            crateMultiplier: 1.12,
            specialTags: ["dense", "forest", "close-range", "cover-to-cover"],
        },
    ),
    profile(
        "woods_snow",
        "Snow Woods",
        "Dense forest combat with cautious exposed snow-field crossings.",
        ["winter_woods"],
        {
            preferredRange: 29,
            combatScanMultiplier: 0.84,
            idealRangeMultiplier: 0.75,
            rotateEarly: 0.72,
            coverPreference: 1.25,
            vegetationPreference: 1.22,
            openFieldAversion: 0.7,
            closeWeaponBias: 1.42,
            longWeaponBias: 0.72,
            specialTags: ["forest", "snow", "close-range", "exposed-clearings"],
        },
    ),
    profile(
        "woods_spring",
        "Spring Woods",
        "Maximum vegetation use with aggressive flanks through dense cover.",
        ["spring_woods"],
        {
            preferredRange: 24,
            combatScanMultiplier: 0.76,
            idealRangeMultiplier: 0.65,
            coverPreference: 1.3,
            vegetationPreference: 1.5,
            closeWeaponBias: 1.58,
            strafeMultiplier: 1.28,
            specialTags: ["forest", "spring", "flank", "concealment"],
        },
    ),
    profile(
        "woods_summer",
        "Summer Woods",
        "Forest fighting with slightly longer clearing engagements and earlier rotations.",
        ["summer_woods"],
        {
            preferredRange: 30,
            combatScanMultiplier: 0.9,
            idealRangeMultiplier: 0.8,
            rotateEarly: 0.68,
            coverPreference: 1.18,
            vegetationPreference: 1.12,
            closeWeaponBias: 1.32,
            longWeaponBias: 0.82,
            specialTags: ["forest", "summer", "clearings", "mixed-range"],
        },
    ),
    profile(
        "savannah",
        "Savannah",
        "Very open map: long-range weapon priority, tree-line routing and early gas movement.",
        ["savanna"],
        {
            preferredRange: 57,
            combatScanMultiplier: 1.32,
            idealRangeMultiplier: 1.42,
            aimJitterMultiplier: 0.86,
            rotateEarly: 0.94,
            openFieldAversion: 1,
            coverPreference: 1,
            vegetationPreference: 0.72,
            buildingPreference: 0.8,
            longWeaponBias: 1.52,
            closeWeaponBias: 0.72,
            specialTags: ["very-open", "long-range", "tree-lines", "early-rotation"],
        },
    ),
    profile(
        "cobalt",
        "Cobalt",
        "Class-aware squad composition, central bunker priority and role-specific equipment.",
        ["perk", "perk_mode"],
        {
            preferredRange: 40,
            combatScanMultiplier: 1.08,
            bunkerPreference: 1.65,
            buildingPreference: 1.1,
            lootMultiplier: 1.12,
            crateMultiplier: 1.18,
            formationScale: 0.82,
            rescueRiskMultiplier: 1.2,
            specialTags: ["classes", "perks", "central-bunker", "role-loot"],
        },
    ),
    profile(
        "turkey",
        "Turkey",
        "Event-object and container priority with compact mid-range squad movement.",
        ["thanksgiving", "turkey_event"],
        {
            preferredRange: 34,
            lootMultiplier: 1.16,
            crateMultiplier: 1.3,
            aggressiveLooting: 0.88,
            formationScale: 0.88,
            closeWeaponBias: 1.18,
            throwableBias: 1.14,
            specialTags: ["event", "containers", "compact-squad", "mid-range"],
        },
    ),
    // Wiki/event aliases not currently present as independent map definitions in
    // TFAGaming/surviv.io. They still receive explicit behaviour when used by a
    // custom server or later map pack.
    profile(
        "storm",
        "Storm",
        "Extreme early rotation, hard-cover routing and reduced looting during dangerous weather.",
        ["storm_mode", "thunderstorm"],
        {
            preferredRange: 39,
            rotateEarly: 1,
            openFieldAversion: 1,
            coverPreference: 1.25,
            aggressiveLooting: 0.35,
            explosiveAvoidance: 1.25,
            healSafetyMultiplier: 1.18,
            specialTags: ["storm", "weather", "hard-cover", "fast-rotation"],
        },
    ),
    profile(
        "valentines",
        "Valentine's",
        "Balanced event routing with increased special-container interest.",
        ["valentine", "love"],
        {
            crateMultiplier: 1.18,
            aggressiveLooting: 0.76,
            buildingPreference: 1,
            specialTags: ["event", "special-containers", "balanced"],
        },
    ),
    profile(
        "saint_patrick",
        "Saint Patrick's",
        "Event-loot hunting while retaining normal-map bunker and building priorities.",
        ["st_patrick", "saintpatrick", "patrick"],
        {
            lootMultiplier: 1.16,
            crateMultiplier: 1.22,
            bunkerPreference: 1.1,
            buildingPreference: 1.05,
            specialTags: ["event", "loot", "buildings"],
        },
    ),
    profile(
        "contact",
        "Contact",
        "Special-object search with cautious approaches to unusual structures and hazards.",
        ["alien", "contact_event"],
        {
            lootMultiplier: 1.14,
            bunkerPreference: 1.25,
            explosiveAvoidance: 1.18,
            specialTags: ["event", "special-structures", "hazards"],
        },
    ),
];

const aliasIndex = new Map<string, MapProfile>();
for (const candidate of MAP_PROFILES) {
    for (const alias of candidate.aliases) aliasIndex.set(normalizeMapName(alias), candidate);
}

function normalizeMapName(value: string): string {
    return String(value || "unknown")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function cloneVec(value: Vec2 | undefined): Vec2 {
    return { x: Number(value?.x) || 0, y: Number(value?.y) || 0 };
}

export function normalizeMapGroundPatch(
    patch: MapGroundPatchSnapshot | GroundPatch,
): MapGroundPatchSnapshot {
    let min: Vec2;
    let max: Vec2;
    if ("bound" in patch) {
        if (patch.bound.type === 0) {
            const center = cloneVec(patch.bound.pos);
            const radius = Math.max(0, Number(patch.bound.rad) || 0);
            min = { x: center.x - radius, y: center.y - radius };
            max = { x: center.x + radius, y: center.y + radius };
        } else {
            min = cloneVec(patch.bound.min);
            max = cloneVec(patch.bound.max);
        }
    } else {
        min = cloneVec(patch.min);
        max = cloneVec(patch.max);
    }
    return {
        color: Number(patch.color) || 0,
        roughness: Number(patch.roughness) || 0,
        offsetDist: Number(patch.offsetDist) || 0,
        order: patch.order,
        useAsMapShape: patch.useAsMapShape,
        min,
        max,
    };
}

function add(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x + b.x, y: a.y + b.y };
}

function sub(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x - b.x, y: a.y - b.y };
}

function mul(value: Vec2, scalar: number): Vec2 {
    return { x: value.x * scalar, y: value.y * scalar };
}

function dot(a: Vec2, b: Vec2): number {
    return a.x * b.x + a.y * b.y;
}

function lengthSq(value: Vec2): number {
    return value.x * value.x + value.y * value.y;
}

function length(value: Vec2): number {
    return Math.sqrt(lengthSq(value));
}

function distance(a: Vec2, b: Vec2): number {
    return length(sub(a, b));
}

function normalize(value: Vec2, fallback: Vec2 = { x: 1, y: 0 }): Vec2 {
    const len = length(value);
    return len > 0.0001 ? { x: value.x / len, y: value.y / len } : cloneVec(fallback);
}

function perpendicular(value: Vec2): Vec2 {
    return { x: -value.y, y: value.x };
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function segmentPointDistance(a: Vec2, b: Vec2, point: Vec2): number {
    const ab = sub(b, a);
    const denominator = lengthSq(ab);
    if (denominator < 0.0001) return distance(a, point);
    const t = clamp(dot(sub(point, a), ab) / denominator, 0, 1);
    return distance(add(a, mul(ab, t)), point);
}

function pointToPolylineDistance(point: Vec2, points: Vec2[], looped: boolean): number {
    if (points.length === 0) return Infinity;
    if (points.length === 1) return distance(point, points[0]);
    let best = Infinity;
    for (let index = 1; index < points.length; index += 1) {
        best = Math.min(best, segmentPointDistance(points[index - 1], points[index], point));
    }
    if (looped && points.length > 2) {
        best = Math.min(best, segmentPointDistance(points[points.length - 1], points[0], point));
    }
    return best;
}

function pseudoRandom(seed: number): number {
    const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return value - Math.floor(value);
}

function containsAny(value: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(value));
}

const BUILDING_PATTERNS = [
    /house/,
    /warehouse/,
    /barn/,
    /hut/,
    /shack/,
    /mansion/,
    /police/,
    /bank/,
    /station/,
    /club/,
    /teahouse/,
    /greenhouse/,
    /complex/,
    /cabin/,
    /outhouse/,
    /structure/,
    /lab/,
    /vault/,
    /dock/,
    /port/,
    /ship/,
    /silo/,
];
const BUNKER_PATTERNS = [/bunker/, /vault/, /underground/, /cellar/, /hydra/, /twins/];
const BRIDGE_PATTERNS = [/bridge/, /crossing/, /causeway/];
const CONTAINER_PATTERNS = [
    /crate/,
    /chest/,
    /cache/,
    /locker/,
    /container/,
    /supply/,
    /loot/,
    /case/,
];
const COVER_PATTERNS = [
    /tree/,
    /stone/,
    /rock/,
    /wall/,
    /hedgehog/,
    /sandbag/,
    /pillar/,
    /statue/,
    /vehicle/,
    /truck/,
    /tractor/,
];
const VEGETATION_PATTERNS = [/tree/, /bush/, /hedge/, /grass/, /shrub/, /plant/];
const HAZARD_PATTERNS = [
    /barrel/,
    /fuel/,
    /tank/,
    /explosive/,
    /bomb/,
    /mine/,
    /airstrike/,
    /missile/,
    /laser/,
];
const SPECIAL_PATTERNS = [
    /potato/,
    /pumpkin/,
    /turkey/,
    /cobalt/,
    /class/,
    /perk/,
    /meteor/,
    /alien/,
    /contact/,
    /gift/,
    /clover/,
    /heart/,
    /snowball/,
];

// Category probabilities are used as relative expected-value weights, not as
// guarantees for one individual drop. The World/Soviet/Surviv values mirror
// the published surviv.io loot-table category shares supplied for this build.
type LootCategory = "gun" | "scope" | "armor" | "medical" | "throwable" | "backpack" | "perk" | "other";

export const LOOT_TIER_CATEGORY_WEIGHTS: Record<LootTierName, Partial<Record<LootCategory, number>>> = {
    world: { gun: 0.3258, scope: 0.1685, armor: 0.1124, medical: 0.191, throwable: 0.0562, backpack: 0.08 },
    soviet: { gun: 0.5, armor: 0.3333, scope: 0.08, medical: 0.06, backpack: 0.04 },
    surviv: { scope: 0.2679, medical: 0.3036, armor: 0.1786, backpack: 0.1607, gun: 0.06 },
    container: { gun: 0.31, scope: 0.12, armor: 0.14, medical: 0.18, throwable: 0.08, backpack: 0.08 },
    airdrop: { gun: 0.42, scope: 0.16, armor: 0.2, medical: 0.08, throwable: 0.1, backpack: 0.08 },
    "military-airdrop": { gun: 0.48, scope: 0.18, armor: 0.24, medical: 0.09, throwable: 0.14, backpack: 0.1 },
    "gold-airdrop": { gun: 0.62, scope: 0.18, armor: 0.22, medical: 0.06, throwable: 0.12, backpack: 0.08 },
    bunker: { gun: 0.36, scope: 0.12, armor: 0.17, medical: 0.12, throwable: 0.08, backpack: 0.08 },
    "class-pod": { gun: 0.24, armor: 0.2, medical: 0.12, backpack: 0.12, perk: 0.34 },
    "perk-cache": { gun: 0.08, scope: 0.18, armor: 0.14, medical: 0.16, backpack: 0.12, perk: 0.4 },
    event: { gun: 0.28, scope: 0.12, armor: 0.13, medical: 0.15, throwable: 0.1, backpack: 0.08, perk: 0.1 },
    unknown: {},
};

function lootCategory(definitionType: string): LootCategory {
    const type = definitionType.toLowerCase();
    if (type === "gun" || type === "melee") return "gun";
    if (type === "scope") return "scope";
    if (type === "helmet" || type === "chest") return "armor";
    if (type === "heal" || type === "boost") return "medical";
    if (type === "throwable") return "throwable";
    if (type === "backpack") return "backpack";
    if (type === "perk") return "perk";
    return "other";
}

function classifyLootSourceType(objectType: string, profileId = "adaptive"): LootSourceContext {
    const type = String(objectType ?? "").toLowerCase();
    const result = (tier: LootTierName, label: string, highValue: number): LootSourceContext => ({
        tier,
        objectType: type,
        label,
        highValue,
    });

    if (
        /gold.*(?:airdrop|drop|crate)|(?:airdrop|drop|crate).*gold|airdrop_crate_03|crate_12/.test(
            type,
        )
    ) {
        return result("gold-airdrop", "gold-airdrop", 185);
    }
    if (
        /military.*(?:airdrop|drop|crate)|(?:airdrop|drop|crate).*military|airdrop_crate_04|crate_13/.test(
            type,
        )
    ) {
        return result("military-airdrop", "military-airdrop", 165);
    }
    if (/airdrop|air_drop|supply_drop|meteor.*(?:crate|drop)|crate_1[01]/.test(type)) {
        return result("airdrop", "airdrop", 140);
    }
    if (/class.*pod|pod.*class|mythic.*pod|cobalt.*pod/.test(type)) {
        return result("class-pod", "class-pod", 145);
    }
    if (/stone.*cache|cloud.*crate|perk.*(?:cache|crate)/.test(type)) {
        return result("perk-cache", "perk-cache", 118);
    }
    if (/soviet|ussr|deposit.*gold|gold.*deposit|bookshelf.*soviet|crate_02f|red.*military.*crate/.test(type)) {
        return result("soviet", "soviet", 105);
    }
    if (/conch.*bunker|twins.*bunker|chrysanthemum.*bunker|hydra.*bunker|bunker|vault|underground/.test(type)) {
        return result("bunker", "bunker", 98);
    }
    if (/surviv.*(?:crate|cache)|hatchet.*crate|coconut.*barrel|jack.*lantern.*cache|cache_0[67]/.test(type)) {
        return result("surviv", "surviv-cache", 86);
    }
    if (/pumpkin|turkey|clover|heart|alien|contact|snow|winter|potato|gift|event/.test(type)) {
        return result("event", `${profileId}-event`, 80);
    }
    if (/crate|locker|bookshelf|deposit|box|chest|container|case|cabinet|loot/.test(type)) {
        return result("world", "world-container", 50);
    }
    return result("unknown", "unknown", 0);
}

function resourceObjectWeight(typeValue: string): number {
    const source = classifyLootSourceType(typeValue);
    if (source.highValue > 0) return Math.max(1, source.highValue / 18);
    const type = typeValue.toLowerCase();
    if (containsAny(type, BUILDING_PATTERNS)) return 2.4;
    if (containsAny(type, CONTAINER_PATTERNS)) return 2;
    return 0;
}

function objectWeight(type: string): number {
    const normalized = type.toLowerCase();
    let score = 0;
    if (containsAny(normalized, BUNKER_PATTERNS)) score += 135;
    if (containsAny(normalized, BUILDING_PATTERNS)) score += 65;
    if (containsAny(normalized, CONTAINER_PATTERNS)) score += 38;
    if (containsAny(normalized, BRIDGE_PATTERNS)) score += 30;
    if (containsAny(normalized, SPECIAL_PATTERNS)) score += 55;
    return score;
}

function inferProfileFromMap(snapshot: MapRuntimeSnapshot): MapProfile {
    const objectNames = snapshot.objects.map((object) => object.type.toLowerCase());
    const treeCount = objectNames.filter((name) => containsAny(name, VEGETATION_PATTERNS)).length;
    const coverCount = objectNames.filter((name) => containsAny(name, COVER_PATTERNS)).length;
    const buildingCount = objectNames.filter((name) => containsAny(name, BUILDING_PATTERNS)).length;
    const bunkerCount = objectNames.filter((name) => containsAny(name, BUNKER_PATTERNS)).length;
    const bridgeCount = objectNames.filter((name) => containsAny(name, BRIDGE_PATTERNS)).length;
    const objectCount = Math.max(1, objectNames.length);
    const vegetationDensity = treeCount / objectCount;
    const hardCoverDensity = (coverCount + buildingCount) / objectCount;
    const riverDensity = snapshot.rivers.length / Math.max(1, (snapshot.width * snapshot.height) / 200000);

    return {
        ...DEFAULT_PROFILE,
        id: normalizeMapName(snapshot.mapName) || "adaptive",
        displayName: snapshot.mapName || "Adaptive / Custom",
        aliases: [snapshot.mapName],
        description: "Automatically inferred from the received map packet.",
        preferredRange: clamp(52 - vegetationDensity * 80, 24, 58),
        combatScanMultiplier: clamp(1.2 - vegetationDensity * 0.8, 0.72, 1.28),
        idealRangeMultiplier: clamp(1.3 - vegetationDensity * 1.05, 0.65, 1.42),
        openFieldAversion: clamp(1.05 - hardCoverDensity * 1.4, 0.38, 1),
        riverRouting: clamp(0.55 + riverDensity * 0.25 + bridgeCount * 0.03, 0.55, 1),
        coverPreference: clamp(0.75 + hardCoverDensity * 1.2, 0.72, 1.25),
        vegetationPreference: clamp(0.35 + vegetationDensity * 2.5, 0.3, 1.35),
        buildingPreference: clamp(0.72 + buildingCount / 35, 0.72, 1.2),
        bunkerPreference: clamp(0.85 + bunkerCount * 0.12, 0.85, 1.55),
        longWeaponBias: clamp(1.35 - vegetationDensity * 1.3, 0.62, 1.45),
        closeWeaponBias: clamp(0.75 + vegetationDensity * 2, 0.75, 1.5),
        specialTags: ["adaptive", "runtime-analysis"],
    };
}

export function getMapProfile(mapName: string, snapshot?: MapRuntimeSnapshot): MapProfile {
    const normalized = normalizeMapName(mapName);
    const direct = aliasIndex.get(normalized);
    if (direct) return direct;

    for (const [alias, candidate] of aliasIndex) {
        if (normalized.includes(alias) || alias.includes(normalized)) return candidate;
    }

    return snapshot ? inferProfileFromMap(snapshot) : DEFAULT_PROFILE;
}

/**
 * Shared read-only map analysis for ordinary AI.
 *
 * Every TacticalBot used to deep-copy the full map snapshot (thousands of
 * static objects plus rivers/places/patches) and re-run the object
 * classification on its own. In a 100-bot 50v50 that produced ~100 identical
 * copies of the same data. Ordinary AI (normal/hard/pro) now shares a single
 * analysis per (mapName, seed); high-performance AI (LEGIT/HACKER) keeps its
 * own copy so its behavior is never coupled to the shared cache.
 */
interface SharedMapAnalysis {
    snapshot: MapRuntimeSnapshot;
    data: ClassifiedMapData;
    profile: MapProfile;
}

const SHARED_MAP_ANALYSES = new Map<string, SharedMapAnalysis>();
const MAX_SHARED_MAP_ANALYSES = 8;

const sharedMapAnalysisKey = (mapName: string, seed: number): string => `${mapName || "unknown"}:${Number(seed) || 0}`;

export class MapNavigator {
    snapshot: MapRuntimeSnapshot = {
        mapName: "unknown",
        seed: 0,
        width: 1024,
        height: 1024,
        shoreInset: 0,
        grassInset: 0,
        rivers: [],
        places: [],
        objects: [],
        groundPatches: [],
    };

    profile: MapProfile = DEFAULT_PROFILE;
    private data: ClassifiedMapData = {
        buildings: [],
        bunkers: [],
        bridges: [],
        containers: [],
        covers: [],
        hazards: [],
        vegetation: [],
        specials: [],
        highValue: [],
        spawnClusters: [],
        tacticalPoints: [],
    };
    private readonly visitedCells = new Map<string, { at: number; pos: Vec2 }>();
    private routeWaypoint: Vec2 | null = null;
    private routeWaypointUntil = 0;

    /**
     * When true (ordinary AI) the map snapshot/classification is shared between
     * every bot in the same (mapName, seed). High-performance AI sets this to
     * false so it keeps an independent copy, exactly as before this cache.
     */
    useSharedAnalysis = true;

    load(snapshot: MapRuntimeInputSnapshot): void {
        const cacheKey = this.useSharedAnalysis
            ? sharedMapAnalysisKey(snapshot.mapName, Number(snapshot.seed) || 0)
            : "";
        if (cacheKey) {
            const cached = SHARED_MAP_ANALYSES.get(cacheKey);
            if (cached) {
                this.snapshot = cached.snapshot;
                this.data = cached.data;
                this.profile = cached.profile;
                this.visitedCells.clear();
                this.routeWaypoint = null;
                this.routeWaypointUntil = 0;
                return;
            }
        }
        this.snapshot = {
            ...snapshot,
            width: Math.max(64, Number(snapshot.width) || 1024),
            height: Math.max(64, Number(snapshot.height) || 1024),
            shoreInset: Math.max(0, Number(snapshot.shoreInset) || 0),
            grassInset: Math.max(0, Number(snapshot.grassInset) || 0),
            rivers: (snapshot.rivers ?? []).map((river) => ({
                width: Math.max(0, Number(river.width) || 0),
                looped: Boolean(river.looped),
                points: (river.points ?? []).map(cloneVec),
            })),
            places: (snapshot.places ?? []).map((place) => ({
                name: String(place.name ?? ""),
                pos: cloneVec(place.pos),
            })),
            objects: (snapshot.objects ?? []).map((object) => ({
                pos: cloneVec(object.pos),
                scale: Number(object.scale) || 1,
                type: String(object.type ?? ""),
                ori: Number(object.ori) || 0,
            })),
            groundPatches: (snapshot.groundPatches ?? []).map(normalizeMapGroundPatch),
        };
        this.profile = getMapProfile(this.snapshot.mapName, this.snapshot);
        this.data = this.analyse();
        if (cacheKey) {
            SHARED_MAP_ANALYSES.set(cacheKey, {
                snapshot: this.snapshot,
                data: this.data,
                profile: this.profile,
            });
            if (SHARED_MAP_ANALYSES.size > MAX_SHARED_MAP_ANALYSES) {
                const oldest = SHARED_MAP_ANALYSES.keys().next().value;
                if (oldest !== undefined) SHARED_MAP_ANALYSES.delete(oldest);
            }
        }
        this.visitedCells.clear();
        this.routeWaypoint = null;
        this.routeWaypointUntil = 0;
    }

    summary(): string {
        return [
            `${this.profile.displayName} (${this.snapshot.mapName || "unknown"})`,
            `objects=${this.snapshot.objects.length}`,
            `places=${this.snapshot.places.length}`,
            `rivers=${this.snapshot.rivers.length}`,
            `buildings=${this.data.buildings.length}`,
            `bunkers=${this.data.bunkers.length}`,
            `bridges=${this.data.bridges.length}`,
            `containers=${this.data.containers.length}`,
            `highValue=${this.data.highValue.length}`,
            `spawnClusters=${this.data.spawnClusters.length}`,
            `cover=${this.data.covers.length}`,
            `tags=${this.profile.specialTags.join("/")}`,
        ].join("; ");
    }

    phase(gasRadius: number | null): MapPhase {
        if (!gasRadius || !Number.isFinite(gasRadius)) return "early";
        const maximum = Math.max(this.snapshot.width, this.snapshot.height) * 0.54;
        const ratio = gasRadius / Math.max(1, maximum);
        if (ratio > 0.65) return "early";
        if (ratio > 0.35) return "mid";
        if (ratio > 0.12) return "late";
        return "final";
    }

    combatScanRange(baseRange: number): number {
        return baseRange * this.profile.combatScanMultiplier;
    }

    idealRange(baseRange: number): number {
        return baseRange * this.profile.idealRangeMultiplier;
    }

    aimJitter(baseJitter: number): number {
        return baseJitter * this.profile.aimJitterMultiplier;
    }

    strafePeriod(basePeriod: number): number {
        return basePeriod * this.profile.strafeMultiplier;
    }

    healEnemyRange(baseRange: number): number {
        return baseRange * this.profile.healSafetyMultiplier;
    }

    formationDistance(baseDistance: number): number {
        return baseDistance * this.profile.formationScale;
    }

    rescueRisk(baseRisk: number): number {
        return baseRisk * this.profile.rescueRiskMultiplier;
    }

    cobaltRole(role: BotMapRole): string | null {
        if (this.profile.id !== "cobalt") return null;
        switch (role) {
            case "leader":
                return "tank";
            case "assault":
                return "assault";
            case "support":
                return "healer";
            case "scout":
                return "sniper";
            default:
                return "scout";
        }
    }

    lootScoreModifier(
        itemType: string,
        definitionType: string,
        role: BotMapRole,
        currentHealth: number,
        inventoryCount: number,
        sourceInput: LootSourceContext | string = "",
    ): number {
        const type = itemType.toLowerCase();
        const defType = definitionType.toLowerCase();
        const source = typeof sourceInput === "string"
            ? classifyLootSourceType(sourceInput, this.profile.id)
            : sourceInput;
        const category = lootCategory(defType);
        let multiplier = this.profile.lootMultiplier;
        let bonus = 0;

        // Convert published tier category shares into a bounded relative-value
        // bonus. This changes route/choice priority but never fabricates loot.
        const sourceChance = LOOT_TIER_CATEGORY_WEIGHTS[source.tier]?.[category];
        const worldChance = LOOT_TIER_CATEGORY_WEIGHTS.world[category];
        if (sourceChance !== undefined && worldChance !== undefined && worldChance > 0.01) {
            bonus += clamp(((sourceChance / worldChance) - 1) * 22, -16, 56);
        }
        multiplier *= 1 + clamp(source.highValue / 360, 0, 0.58);

        if (defType === "gun") {
            const close = /shotgun|smg|mp220|m870|saiga|usas|mac|vector|pistol/.test(type);
            const long = /sniper|mosin|sv98|awc|awm|scout|dmr|mk12|m39|garand/.test(type);
            if (close) multiplier *= this.profile.closeWeaponBias;
            if (long) multiplier *= this.profile.longWeaponBias;
            if (this.profile.id.startsWith("potato")) bonus += 20;
            if ((source.tier === "soviet" || source.tier === "bunker") && long) bonus += 18;
        }
        if (defType === "throwable") multiplier *= this.profile.throwableBias;
        if (defType === "scope") {
            if (this.profile.longWeaponBias > 1.15) bonus += 24;
            if (/8x|15x/.test(type) && (source.tier === "surviv" || source.tier.includes("airdrop"))) bonus += 24;
        }
        if ((defType === "heal" || defType === "boost") && currentHealth < 70) bonus += 18;
        if (this.profile.id.startsWith("potato") && defType === "ammo") {
            bonus += Math.max(4, 24 - inventoryCount * 0.08);
        }

        if (source.tier === "airdrop" || source.tier === "military-airdrop" || source.tier === "gold-airdrop") {
            multiplier *= source.tier === "gold-airdrop" ? 1.55 : source.tier === "military-airdrop" ? 1.38 : 1.24;
            if (/awm|pkp|m249|garand|sv98|scarssr/.test(type)) bonus += source.tier === "gold-airdrop" ? 52 : 40;
            if (
                (defType === "helmet" || defType === "chest" || defType === "backpack")
                && /03|3|level_?3|lv_?3/.test(type)
            ) bonus += 38;
        }

        if (this.profile.id === "desert") {
            if (/awm|sv98|mosin|scout|dmr|mk12|m39|garand|8x|15x/.test(type)) bonus += 24;
            if (source.tier.includes("airdrop")) bonus += 24;
        }
        if (this.profile.id.startsWith("woods")) {
            if (/shotgun|smg|mp220|m870|saiga|mac|vector|melee|axe|hatchet|katana/.test(type)) bonus += 20;
            if (source.tier === "surviv" || /hatchet/.test(source.objectType)) bonus += 20;
        }
        if (this.profile.id === "faction") {
            if (source.tier === "military-airdrop" || /military|role/.test(source.objectType)) multiplier *= 1.32;
            if (defType === "heal" || defType === "boost") bonus += 18;
        }
        if (this.profile.id === "cobalt") {
            if (source.tier === "class-pod" || defType === "perk") bonus += 35;
            if (role === "support" && (defType === "heal" || defType === "boost" || defType === "ammo")) bonus += 28;
            if (role === "scout" && (defType === "scope" || /sniper|dmr/.test(type))) bonus += 34;
            if (role === "assault" && defType === "gun" && !/sniper|dmr/.test(type)) bonus += 20;
            if (role === "leader" && (defType === "helmet" || defType === "chest")) bonus += 20;
        }
        if (this.profile.id === "savannah" && source.tier === "perk-cache") bonus += 30;
        if (this.profile.id === "halloween" && /pumpkin|spooky|event|katana/.test(type + source.objectType)) {
            bonus += 32;
        }
        if (this.profile.id === "turkey" && /turkey|event|special/.test(type)) bonus += 30;
        if (this.profile.id === "contact" && /alien|laser|contact/.test(type)) bonus += 34;
        if (this.profile.id === "saint_patrick" && /clover|green|event/.test(type)) bonus += 26;
        if (this.profile.id === "valentines" && /heart|love|event/.test(type)) bonus += 26;

        return multiplier * 18 - 18 + bonus;
    }

    classifyLootSource(objectType: string, pos?: Vec2): LootSourceContext {
        const source = classifyLootSourceType(objectType, this.profile.id);
        return pos ? { ...source, pos: cloneVec(pos) } : source;
    }

    lootSourceContextAt(pos: Vec2, dynamicObjectType = ""): LootSourceContext {
        const dynamic = classifyLootSourceType(dynamicObjectType, this.profile.id);
        let best = dynamic;
        let bestScore = dynamic.highValue;
        for (const point of this.data.highValue) {
            const dist = distance(pos, point.pos);
            if (dist > 20) continue;
            const candidate = classifyLootSourceType(point.label, this.profile.id);
            const score = candidate.highValue - dist * 2.2;
            if (score > bestScore) {
                best = { ...candidate, pos: cloneVec(point.pos) };
                bestScore = score;
            }
        }
        if (best.tier === "unknown") {
            const nearContainer = this.data.containers.find((object) => distance(pos, object.pos) <= 9);
            if (nearContainer) best = this.classifyLootSource(nearContainer.type, nearContainer.pos);
        }
        return best.tier === "unknown"
            ? { ...classifyLootSourceType("crate_world", this.profile.id), pos: cloneVec(pos) }
            : { ...best, pos: best.pos ?? cloneVec(pos) };
    }

    crateScoreModifier(crateType: string, remainingHealth: number, role: BotMapRole): number {
        const type = crateType.toLowerCase();
        const source = classifyLootSourceType(type, this.profile.id);
        let bonus = (this.profile.crateMultiplier - 1) * 70;
        bonus += source.highValue * 0.42;
        bonus += (1 - clamp(remainingHealth, 0, 1)) * 7;
        if (containsAny(type, SPECIAL_PATTERNS)) bonus += 28;
        if (/mil|airdrop|supply|gold|rare|chest_03|cache_06|cache_07/.test(type)) bonus += 32;
        if (this.profile.id === "cobalt" && /cache|bunker|class|perk/.test(type)) bonus += 30;
        if (this.profile.id.startsWith("potato") && /potato|crate|chest|cache/.test(type)) bonus += 30;
        if (role === "support" && /medical|med|heal|supply/.test(type)) bonus += 16;
        return bonus;
    }

    shouldBreakCrate(enemyDistance: number, health: number, phase: MapPhase): boolean {
        const phasePenalty = phase === "final" ? 18 : phase === "late" ? 7 : 0;
        const minimumEnemyDistance = 25 + phasePenalty - this.profile.aggressiveLooting * 7;
        const minimumHealth = 34 + phasePenalty * 0.55 - this.profile.aggressiveLooting * 6;
        return enemyDistance >= minimumEnemyDistance && health >= minimumHealth;
    }

    /** Returns true for map objects that can explode or otherwise punish melee attacks. */
    isHazardObject(objectType: string): boolean {
        return containsAny(String(objectType).toLowerCase(), HAZARD_PATTERNS);
    }

    /**
     * Event maps contain useful breakables that are not consistently named crate/chest.
     * Keep this map-aware so normal rocks, trees and walls never become attack targets.
     */
    isSpecialBreakable(objectType: string): boolean {
        const type = String(objectType).toLowerCase();
        if (this.isHazardObject(type)) return false;

        switch (this.profile.id) {
            case "potato":
            case "potato_spring":
                return /potato|spud|potato.*obstacle|potato.*cache/.test(type);
            case "halloween":
                return /pumpkin|coffin|spooky.*crate|halloween.*cache/.test(type);
            case "turkey":
                return /turkey|feast|cornucopia|pumpkin.*crate/.test(type);
            case "snow":
            case "woods_snow":
                return /snow.*(?:crate|cache|chest)|ice.*(?:crate|cache|chest)/.test(type);
            case "cobalt":
                return /class.*(?:pod|crate|cache)|perk.*(?:crate|cache)|cobalt.*(?:crate|cache)/.test(type);
            case "savannah":
                return /cloud.*crate|crate_02sv|savannah.*(?:crate|cache)/.test(type);
            case "contact":
                return /alien.*(?:crate|cache|pod)|contact.*(?:crate|cache)|meteor.*cache/.test(type);
            case "saint_patrick":
                return /clover.*(?:crate|cache)|green.*crate/.test(type);
            case "valentines":
                return /heart.*(?:crate|cache)|love.*crate/.test(type);
            default:
                return false;
        }
    }

    /** Extra reserve compensates for sparse or reduced ammunition drops. */
    ammoReserveMultiplier(): number {
        switch (this.profile.id) {
            case "savannah":
                return 1.55;
            case "faction":
                return 1.22;
            case "desert":
                return 1.15;
            case "woods":
            case "woods_snow":
            case "woods_spring":
            case "woods_summer":
                return 1.08;
            case "potato":
            case "potato_spring":
                return 0.95;
            default:
                return 1;
        }
    }

    /**
     * On exposed maps, move to nearby hard cover before committing to a long heal.
     * Critical-health bots skip this detour in smartBot.ts and heal immediately.
     */
    medicineCoverTarget(myPos: Vec2, enemyPos: Vec2 | null, role: BotMapRole): Vec2 | null {
        if (this.data.covers.length === 0) return null;
        const shouldSeek = this.profile.openFieldAversion >= 0.72
            || this.profile.coverPreference >= 0.94
            || this.profile.id === "faction";
        if (!shouldSeek) return null;

        if (enemyPos) {
            const combatCover = this.bestCombatCover(myPos, enemyPos, role);
            return combatCover ? cloneVec(combatCover.pos) : null;
        }

        let best: StaticMapObject | null = null;
        let bestScore = Infinity;
        const sampleStep = Math.max(1, Math.floor(this.data.covers.length / 260));
        for (let index = 0; index < this.data.covers.length; index += sampleStep) {
            const cover = this.data.covers[index];
            const dist = distance(myPos, cover.pos);
            if (dist < 3 || dist > 16 + this.profile.coverPreference * 8) continue;
            const hazardPenalty = this.data.hazards.some((hazard) => distance(cover.pos, hazard.pos) < 7)
                ? 25
                : 0;
            const score = dist + hazardPenalty;
            if (score < bestScore) {
                bestScore = score;
                best = cover;
            }
        }
        return best ? cloneVec(best.pos) : null;
    }

    gasRotationTarget(
        from: Vec2,
        center: Vec2,
        radius: number,
        phase: MapPhase,
        role: BotMapRole,
        formationAnchor: Vec2 | null = null,
    ): Vec2 {
        const fallbackDirection = normalize(sub(from, center), { x: 1, y: 0 });
        const formationDirection = formationAnchor
            ? normalize(sub(formationAnchor, center), fallbackDirection)
            : fallbackDirection;
        let ringFactor = phase === "final" ? 0.24 : phase === "late" ? 0.42 : phase === "mid" ? 0.58 : 0.7;
        if (role === "assault" || role === "scout") ringFactor += phase === "final" ? 0.04 : 0.07;
        if (role === "support") ringFactor -= 0.05;
        if (this.profile.id === "faction" && phase !== "early") ringFactor -= 0.04;
        const safeRadius = Math.max(0, radius - (phase === "final" ? 5 : 8));
        return this.constrainPoint(
            add(center, mul(formationDirection, Math.max(0, safeRadius * clamp(ringFactor, 0.12, 0.78)))),
        );
    }

    /**
     * Select a point just inside the safe-zone edge. This is used for late-game
     * edge control and for cutting off opponents who are being pushed by gas.
     */
    ringControlTarget(
        from: Vec2,
        center: Vec2,
        radius: number,
        phase: MapPhase,
        role: BotMapRole,
        enemyPos: Vec2 | null = null,
        formationAnchor: Vec2 | null = null,
    ): Vec2 {
        const fallback = normalize(sub(from, center), { x: 1, y: 0 });
        const formationDirection = formationAnchor
            ? normalize(sub(formationAnchor, center), fallback)
            : fallback;
        const enemyDirection = enemyPos
            ? normalize(sub(enemyPos, center), formationDirection)
            : formationDirection;
        let direction = enemyPos && phase !== "early"
            ? normalize(add(mul(enemyDirection, 0.78), mul(formationDirection, 0.22)))
            : formationDirection;

        // Scouts/assault players take a slight tangent to cut rotations instead
        // of stacking directly behind the same radial line.
        if (role === "scout" || role === "assault") {
            const sign = pseudoRandom(this.snapshot.seed + from.x * 0.17 + from.y * 0.31) < 0.5 ? -1 : 1;
            direction = normalize(
                add(direction, mul(perpendicular(direction), sign * (phase === "final" ? 0.2 : 0.32))),
            );
        }

        let offset = phase === "final" ? 10 : phase === "late" ? 16 : phase === "mid" ? 23 : 31;
        if (role === "support") offset += 5;
        if (this.profile.openFieldAversion > 0.9) offset += 3;
        const targetRadius = Math.max(0, radius - offset);
        return this.constrainPoint(add(center, mul(direction, targetRadius)));
    }

    /**
     * Pick a hard-cover position inside the late circle. The map does not expose
     * a universal height field, so buildings/bunkers and durable cover are used
     * as the reliable position-control signal.
     */
    lateGamePositionTarget(
        from: Vec2,
        center: Vec2,
        radius: number,
        role: BotMapRole,
        enemyPos: Vec2 | null = null,
    ): Vec2 | null {
        const safeMargin = Math.max(7, radius * 0.08);
        const desiredRadius = Math.max(0, radius - (role === "support" ? 18 : 12));
        const candidates = [...this.data.covers, ...this.data.buildings, ...this.data.bunkers];
        if (candidates.length === 0) return null;

        let best: StaticMapObject | null = null;
        let bestScore = Infinity;
        const step = Math.max(1, Math.floor(candidates.length / 320));
        for (let index = 0; index < candidates.length; index += step) {
            const candidate = candidates[index];
            const centerDistance = distance(candidate.pos, center);
            if (centerDistance > Math.max(0, radius - safeMargin)) continue;
            const travel = distance(from, candidate.pos);
            if (travel > Math.max(42, radius * 0.82)) continue;
            const hazardPenalty = this.data.hazards.some((hazard) => distance(candidate.pos, hazard.pos) < 8)
                ? 55
                : 0;
            const ringError = Math.abs(centerDistance - desiredRadius);
            let enemyTerm = 0;
            if (enemyPos) {
                const enemyDistance = distance(candidate.pos, enemyPos);
                enemyTerm = enemyDistance < 6 ? 42 : -Math.min(18, enemyDistance * 0.12);
            }
            const type = candidate.type.toLowerCase();
            const hardCoverBonus = /bunker|stone|rock|wall|house|warehouse|silo/.test(type) ? -16 : 0;
            const roleTerm = role === "support" ? -4 : role === "assault" ? 3 : 0;
            const score = travel * 0.42 + ringError * 0.55 + hazardPenalty + enemyTerm + hardCoverBonus + roleTerm;
            if (score < bestScore) {
                bestScore = score;
                best = candidate;
            }
        }
        return best ? this.constrainPoint(cloneVec(best.pos)) : null;
    }

    phaseAggressionMultiplier(phase: MapPhase): number {
        if (this.profile.id === "faction") {
            if (phase === "final") return 1.2;
            if (phase === "late") return 1.1;
            return 1.03;
        }
        if (phase === "final") return 1.08;
        return 1;
    }

    factionObjectiveTarget(
        from: Vec2,
        target: Vec2,
        phase: MapPhase,
        role: BotMapRole,
        objectiveKind: string,
    ): Vec2 {
        const constrainedTarget = this.constrainPoint(target);
        if (this.profile.id !== "faction" || this.data.bridges.length === 0 || phase === "final") {
            return constrainedTarget;
        }
        const shouldControlBridge = objectiveKind === "bridgehead"
            || ((phase === "early" || phase === "mid") && this.profile.bridgePreference >= 1.1);
        if (!shouldControlBridge) return constrainedTarget;

        let best: StaticMapObject | null = null;
        let bestScore = Infinity;
        for (const bridge of this.data.bridges) {
            const score = distance(bridge.pos, constrainedTarget) * 0.62 + distance(from, bridge.pos) * 0.2;
            if (score < bestScore) {
                best = bridge;
                bestScore = score;
            }
        }
        if (!best) return constrainedTarget;
        if (objectiveKind !== "bridgehead" && distance(best.pos, constrainedTarget) > 155) {
            return constrainedTarget;
        }

        const advance = normalize(sub(constrainedTarget, best.pos));
        const roleOffset = role === "assault" ? 7 : role === "scout" ? 10 : role === "support" ? -6 : 2;
        return this.constrainPoint(add(best.pos, mul(advance, roleOffset)));
    }

    adjustStrategicDirection(
        from: Vec2,
        target: Vec2,
        phase: MapPhase,
        role: BotMapRole,
        timestamp: number,
    ): Vec2 {
        const constrainedTarget = this.constrainPoint(target);
        if (this.routeWaypoint && timestamp < this.routeWaypointUntil) {
            if (distance(from, this.routeWaypoint) > 3.2) {
                return normalize(sub(this.routeWaypoint, from));
            }
            this.routeWaypoint = null;
        }

        let waypoint: Vec2 | null = null;
        if (this.profile.riverRouting > 0.35 && this.segmentCrossesRiver(from, constrainedTarget)) {
            waypoint = this.bestBridgeWaypoint(from, constrainedTarget);
        }

        if (!waypoint && this.profile.openFieldAversion > 0.58 && phase !== "final") {
            waypoint = this.coverWaypointOnRoute(from, constrainedTarget, role);
        }

        if (!waypoint && this.profile.explosiveAvoidance > 0.4) {
            waypoint = this.hazardAvoidanceWaypoint(from, constrainedTarget);
        }

        if (waypoint) {
            this.routeWaypoint = this.constrainPoint(waypoint);
            this.routeWaypointUntil = timestamp + 4200;
            return normalize(sub(this.routeWaypoint, from));
        }

        return normalize(sub(constrainedTarget, from));
    }

    combatMovementDirection(
        myPos: Vec2,
        enemyPos: Vec2,
        baseDirection: Vec2,
        health: number,
        role: BotMapRole,
        phase: MapPhase,
    ): Vec2 {
        const needsCover = health < 58
            || this.profile.openFieldAversion > 0.82
            || (phase === "final" && this.profile.coverPreference > 0.9);
        if (!needsCover || this.data.covers.length === 0) return normalize(baseDirection);

        const cover = this.bestCombatCover(myPos, enemyPos, role);
        if (!cover) return normalize(baseDirection);
        const toCover = normalize(sub(cover.pos, myPos));
        const blend = clamp(0.28 + this.profile.coverPreference * 0.28 + (health < 35 ? 0.25 : 0), 0.3, 0.82);
        return normalize(add(mul(normalize(baseDirection), 1 - blend), mul(toCover, blend)));
    }

    chooseExploreTarget(
        from: Vec2,
        role: BotMapRole,
        phase: MapPhase,
        gasCenter: Vec2 | null,
        gasRadius: number | null,
        timestamp: number,
        squadSlot: number,
        botSeed = squadSlot,
        resourcePriority = 0,
    ): Vec2 {
        this.pruneVisited(timestamp);
        const candidates = this.data.tacticalPoints.filter((point) => {
            if (!gasCenter || !gasRadius) return true;
            const safety = phase === "early" ? 1.05 : phase === "mid" ? 0.93 : 0.8;
            return distance(point.pos, gasCenter) <= gasRadius * safety;
        });

        let best: TacticalPoint | null = null;
        let bestScore = -Infinity;
        for (let index = 0; index < candidates.length; index += 1) {
            const point = candidates[index];
            const dist = distance(from, point.pos);
            if (dist < 4) continue;
            let score = point.score - dist * (phase === "early" ? 0.34 : 0.52);
            score += this.pointKindBias(point.kind, role, phase);
            if (resourcePriority > 0) {
                if (point.kind === "resource") score += 115 * resourcePriority;
                else if (point.kind === "spawn") score += 52 * resourcePriority;
                else if (point.kind === "building") score += 34 * resourcePriority;
            }
            if (phase === "early" && point.kind === "spawn") {
                // Actual `from` is the player's received spawn position. Prefer
                // a nearby dense cluster, but do not cross half the map for one.
                score += clamp(72 - dist * 0.42, -35, 72);
            }
            if (point.kind === "resource" && this.profile.id === "desert") score += this.profile.airdropInterest * 18;
            score -= this.visitedPenalty(point.pos, timestamp);
            // Larger per-bot jitter so multiple idle AI (e.g. non-hunter
            // extraction bots that do not loot) do not all converge on the
            // single highest-scoring tactical point.
            score += (pseudoRandom(this.snapshot.seed + index * 97 + squadSlot * 31 + botSeed * 131) - 0.5) * 30;
            if (gasCenter && gasRadius) {
                const centerDistance = distance(point.pos, gasCenter);
                const targetRadius = phase === "final" ? gasRadius * 0.32 : gasRadius * 0.62;
                score -= Math.abs(centerDistance - targetRadius) * this.profile.lateCenterBias * 0.15;
            }
            if (score > bestScore) {
                bestScore = score;
                best = point;
            }
        }

        let selected: Vec2;
        if (best) {
            selected = cloneVec(best.pos);
        } else if (gasCenter && gasRadius) {
            const angle = pseudoRandom(timestamp * 0.00017 + squadSlot * 13 + botSeed * 19 + this.snapshot.seed)
                * Math.PI * 2;
            const ratio = phase === "final" ? 0.25 : phase === "late" ? 0.45 : 0.68;
            selected = {
                x: gasCenter.x + Math.cos(angle) * gasRadius * ratio,
                y: gasCenter.y + Math.sin(angle) * gasRadius * ratio,
            };
        } else {
            const margin = Math.max(16, this.snapshot.shoreInset + this.snapshot.grassInset * 0.25);
            selected = {
                x: margin
                    + pseudoRandom(timestamp + this.snapshot.seed + squadSlot * 17 + botSeed * 73)
                        * Math.max(1, this.snapshot.width - margin * 2),
                y: margin
                    + pseudoRandom(timestamp * 1.71 + this.snapshot.seed + squadSlot * 29 + botSeed * 101)
                        * Math.max(1, this.snapshot.height - margin * 2),
            };
        }

        // Scatter the landing spot per bot (stable seed, no time drift) so AI
        // that picked the same tactical point do not stack on top of each
        // other. The offset stays within the point's neighbourhood.
        const scatterAngle = pseudoRandom(this.snapshot.seed + botSeed * 61 + squadSlot * 17)
            * Math.PI
            * 2;
        const scatterDist = 3
            + pseudoRandom(this.snapshot.seed + botSeed * 97 + squadSlot * 29)
                * 13;
        selected = this.constrainPoint({
            x: selected.x + Math.cos(scatterAngle) * scatterDist,
            y: selected.y + Math.sin(scatterAngle) * scatterDist,
        });
        // Selection is not a visit. Marking the cell here made an unarmed bot
        // de-prioritize a resource cluster before it had crossed the map to it;
        // a timeout or brief combat interruption then sent it to another random
        // cluster. The movement owner calls markVisited only on actual arrival.
        return selected;
    }

    markVisited(pos: Vec2, timestamp: number): void {
        this.visitedCells.set(this.cellKey(pos, 34), {
            at: timestamp,
            pos: cloneVec(pos),
        });
    }

    nearestTacticalLabel(pos: Vec2): string {
        let best: TacticalPoint | null = null;
        let bestDistance = Infinity;
        for (const point of this.data.tacticalPoints) {
            const dist = distance(pos, point.pos);
            if (dist < bestDistance) {
                bestDistance = dist;
                best = point;
            }
        }
        return best && bestDistance < 45 ? `${best.kind}:${best.label}` : "open-ground";
    }

    private analyse(): ClassifiedMapData {
        const result: ClassifiedMapData = {
            buildings: [],
            bunkers: [],
            bridges: [],
            containers: [],
            covers: [],
            hazards: [],
            vegetation: [],
            specials: [],
            highValue: [],
            spawnClusters: [],
            tacticalPoints: [],
        };

        const resourceGrid = new Map<string, { x: number; y: number; weight: number; labels: string[] }>();
        for (const object of this.snapshot.objects) {
            const type = object.type.toLowerCase();
            if (containsAny(type, BUILDING_PATTERNS)) result.buildings.push(object);
            if (containsAny(type, BUNKER_PATTERNS)) result.bunkers.push(object);
            if (containsAny(type, BRIDGE_PATTERNS)) result.bridges.push(object);
            if (containsAny(type, CONTAINER_PATTERNS)) result.containers.push(object);
            if (containsAny(type, COVER_PATTERNS) || containsAny(type, BUILDING_PATTERNS)) result.covers.push(object);
            if (containsAny(type, HAZARD_PATTERNS)) result.hazards.push(object);
            if (containsAny(type, VEGETATION_PATTERNS)) result.vegetation.push(object);
            if (containsAny(type, SPECIAL_PATTERNS)) result.specials.push(object);

            const source = classifyLootSourceType(type, this.profile.id);
            if (source.highValue >= 72) {
                const point: TacticalPoint = {
                    pos: cloneVec(object.pos),
                    score: source.highValue,
                    kind: "resource",
                    label: object.type,
                };
                result.highValue.push(point);
                result.tacticalPoints.push(point);
            }

            const resourceWeight = resourceObjectWeight(type);
            if (resourceWeight > 0) {
                const key = this.cellKey(object.pos, 72);
                const existing = resourceGrid.get(key) ?? { x: 0, y: 0, weight: 0, labels: [] };
                existing.x += object.pos.x * resourceWeight;
                existing.y += object.pos.y * resourceWeight;
                existing.weight += resourceWeight;
                if (existing.labels.length < 4) existing.labels.push(object.type);
                resourceGrid.set(key, existing);
            }
        }

        for (const place of this.snapshot.places) {
            result.tacticalPoints.push({
                pos: cloneVec(place.pos),
                score: 128,
                kind: "place",
                label: place.name || "named-place",
            });
        }

        const grid = new Map<
            string,
            { x: number; y: number; weight: number; labels: string[]; kind: TacticalPoint["kind"] }
        >();
        for (const object of this.snapshot.objects) {
            const weight = objectWeight(object.type);
            if (weight <= 0) continue;
            const key = this.cellKey(object.pos, 54);
            const normalized = object.type.toLowerCase();
            const kind: TacticalPoint["kind"] = containsAny(normalized, BUNKER_PATTERNS)
                ? "bunker"
                : containsAny(normalized, BRIDGE_PATTERNS)
                ? "bridge"
                : containsAny(normalized, SPECIAL_PATTERNS)
                ? "special"
                : containsAny(normalized, BUILDING_PATTERNS)
                ? "building"
                : "container";
            const existing = grid.get(key) ?? { x: 0, y: 0, weight: 0, labels: [], kind };
            existing.x += object.pos.x * weight;
            existing.y += object.pos.y * weight;
            existing.weight += weight;
            if (existing.labels.length < 3) existing.labels.push(object.type);
            if (kind === "bunker" || (kind === "special" && existing.kind !== "bunker")) existing.kind = kind;
            grid.set(key, existing);
        }

        for (const cluster of grid.values()) {
            if (cluster.weight <= 0) continue;
            result.tacticalPoints.push({
                pos: { x: cluster.x / cluster.weight, y: cluster.y / cluster.weight },
                score: clamp(cluster.weight * 0.34, 42, 220),
                kind: cluster.kind,
                label: cluster.labels.join("+") || cluster.kind,
            });
        }

        // Map packets do not expose canonical player-spawn markers. These are
        // opening resource clusters; chooseExploreTarget scores them relative to
        // the bot's actual first position, which provides spawn-aware routing
        // without inventing hidden spawn coordinates.
        const spawnCandidates = [...resourceGrid.values()]
            .filter((cluster) => cluster.weight >= 5.2)
            .map<TacticalPoint>((cluster) => ({
                pos: { x: cluster.x / cluster.weight, y: cluster.y / cluster.weight },
                score: clamp(52 + cluster.weight * 7.5, 64, 185),
                kind: "spawn",
                label: cluster.labels.join("+") || "resource-cluster",
            }))
            .sort((a, b) => b.score - a.score);
        for (const candidate of spawnCandidates) {
            if (result.spawnClusters.some((point) => distance(point.pos, candidate.pos) < 42)) continue;
            result.spawnClusters.push(candidate);
            result.tacticalPoints.push(candidate);
            if (result.spawnClusters.length >= 28) break;
        }

        const coverStep = Math.max(1, Math.floor(result.covers.length / 80));
        for (let index = 0; index < result.covers.length; index += coverStep) {
            const cover = result.covers[index];
            result.tacticalPoints.push({
                pos: cloneVec(cover.pos),
                score: 24,
                kind: "cover",
                label: cover.type,
            });
        }

        result.highValue.sort((a, b) => b.score - a.score);
        result.highValue = result.highValue.slice(0, 64);
        result.tacticalPoints.sort((a, b) => b.score - a.score);
        result.tacticalPoints = result.tacticalPoints.slice(0, 210);
        return result;
    }

    private pointKindBias(kind: TacticalPoint["kind"], role: BotMapRole, phase: MapPhase): number {
        let score = 0;
        if (kind === "building") score += this.profile.buildingPreference * 35;
        if (kind === "bunker") score += this.profile.bunkerPreference * 48;
        if (kind === "bridge") score += this.profile.bridgePreference * 30;
        if (kind === "container") score += this.profile.aggressiveLooting * 38;
        if (kind === "cover") score += this.profile.coverPreference * (phase === "early" ? 12 : 30);
        if (kind === "special") score += 40;
        if (kind === "resource") score += this.profile.aggressiveLooting * 42 + this.profile.airdropInterest * 18;
        if (kind === "spawn") score += phase === "early" ? 62 + this.profile.aggressiveLooting * 28 : -18;
        if (role === "scout" && kind === "bridge") score += 12;
        if (role === "support" && (kind === "building" || kind === "cover")) score += 10;
        if (role === "assault" && (kind === "container" || kind === "bunker")) score += 12;
        if (
            phase === "final" && (kind === "container" || kind === "place" || kind === "resource" || kind === "spawn")
        ) score -= 35;
        return score;
    }

    private segmentCrossesRiver(from: Vec2, to: Vec2): boolean {
        for (const river of this.snapshot.rivers) {
            if (river.points.length < 2 || river.width <= 0) continue;
            const samples = Math.max(6, Math.ceil(distance(from, to) / 14));
            for (let index = 1; index < samples; index += 1) {
                const point = lerp(from, to, index / samples);
                if (pointToPolylineDistance(point, river.points, river.looped) <= river.width * 0.62 + 1.5) {
                    return true;
                }
            }
        }
        return false;
    }

    private bestBridgeWaypoint(from: Vec2, target: Vec2): Vec2 | null {
        if (this.data.bridges.length === 0) return null;
        const direct = distance(from, target);
        let best: Vec2 | null = null;
        let bestCost = Infinity;
        for (const bridge of this.data.bridges) {
            const cost = distance(from, bridge.pos) + distance(bridge.pos, target);
            const routeBias = this.profile.id === "faction" ? 0.82 : 1;
            if (cost * routeBias < bestCost && cost <= direct * (1.75 - this.profile.riverRouting * 0.35) + 24) {
                bestCost = cost * routeBias;
                best = bridge.pos;
            }
        }
        return best ? cloneVec(best) : null;
    }

    private coverWaypointOnRoute(from: Vec2, target: Vec2, role: BotMapRole): Vec2 | null {
        const direct = distance(from, target);
        if (direct < 18) return null;
        let best: StaticMapObject | null = null;
        let bestScore = Infinity;
        const preferredForward = role === "scout" || role === "assault" ? 0.68 : 0.48;
        const preferredPoint = lerp(from, target, preferredForward);
        const sampleStep = Math.max(1, Math.floor(this.data.covers.length / 220));
        for (let index = 0; index < this.data.covers.length; index += sampleStep) {
            const cover = this.data.covers[index];
            const routeDistance = segmentPointDistance(from, target, cover.pos);
            if (routeDistance > 15 + this.profile.openFieldAversion * 11) continue;
            const forwardDistance = distance(preferredPoint, cover.pos);
            const startDistance = distance(from, cover.pos);
            if (startDistance < 5 || startDistance > direct * 0.88 + 15) continue;
            const score = routeDistance * 1.6 + forwardDistance * 0.45;
            if (score < bestScore) {
                bestScore = score;
                best = cover;
            }
        }
        return best ? cloneVec(best.pos) : null;
    }

    private hazardAvoidanceWaypoint(from: Vec2, target: Vec2): Vec2 | null {
        let closest: StaticMapObject | null = null;
        let closestDistance = Infinity;
        for (const hazard of this.data.hazards) {
            const dist = segmentPointDistance(from, target, hazard.pos);
            if (dist < closestDistance && dist < 5.5 + this.profile.explosiveAvoidance * 3.5) {
                closestDistance = dist;
                closest = hazard;
            }
        }
        if (!closest) return null;
        const forward = normalize(sub(target, from));
        const side = perpendicular(forward);
        const sign = dot(sub(closest.pos, from), side) >= 0 ? -1 : 1;
        return add(closest.pos, mul(side, sign * (8 + this.profile.explosiveAvoidance * 5)));
    }

    private bestCombatCover(myPos: Vec2, enemyPos: Vec2, role: BotMapRole): StaticMapObject | null {
        let best: StaticMapObject | null = null;
        let bestScore = Infinity;
        const enemyDirection = normalize(sub(enemyPos, myPos));
        const sampleStep = Math.max(1, Math.floor(this.data.covers.length / 260));
        for (let index = 0; index < this.data.covers.length; index += sampleStep) {
            const cover = this.data.covers[index];
            const myDistance = distance(myPos, cover.pos);
            if (myDistance < 2.5 || myDistance > 18 + this.profile.coverPreference * 11) continue;
            const enemyDistance = distance(enemyPos, cover.pos);
            if (enemyDistance < 5) continue;
            const direction = normalize(sub(cover.pos, myPos));
            const lateral = Math.abs(dot(direction, perpendicular(enemyDirection)));
            const behind = dot(direction, enemyDirection) < 0 ? -4 : 0;
            const roleBonus = role === "support" ? -2 : role === "assault" ? 1.5 : 0;
            const score = myDistance - lateral * 5 + behind + roleBonus;
            if (score < bestScore) {
                bestScore = score;
                best = cover;
            }
        }
        return best;
    }

    private constrainPoint(point: Vec2): Vec2 {
        const waterMargin = (this.snapshot.shoreInset + this.snapshot.grassInset * 0.45) * this.profile.waterAversion;
        const margin = clamp(Math.max(10, waterMargin), 10, Math.min(this.snapshot.width, this.snapshot.height) * 0.22);
        return {
            x: clamp(point.x, margin, Math.max(margin, this.snapshot.width - margin)),
            y: clamp(point.y, margin, Math.max(margin, this.snapshot.height - margin)),
        };
    }

    private cellKey(pos: Vec2, size: number): string {
        return `${Math.floor(pos.x / size)}:${Math.floor(pos.y / size)}`;
    }

    private visitedPenalty(pos: Vec2, timestamp: number): number {
        const cellSize = 34;
        const cellX = Math.floor(pos.x / cellSize);
        const cellY = Math.floor(pos.y / cellSize);
        let penalty = 0;
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
            for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
                const visit = this.visitedCells.get(
                    `${cellX + offsetX}:${cellY + offsetY}`,
                );
                if (!visit) continue;
                const age = timestamp - visit.at;
                const separation = distance(pos, visit.pos);
                if (age >= 25_000 || separation >= 30) continue;
                penalty = Math.max(
                    penalty,
                    65 * (1 - age / 25_000) * (1 - separation / 34),
                );
            }
        }
        return penalty;
    }

    private pruneVisited(timestamp: number): void {
        for (const [key, visit] of this.visitedCells) {
            if (timestamp - visit.at > 30_000) this.visitedCells.delete(key);
        }
    }
}
