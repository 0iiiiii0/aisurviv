import { ThrowableDefs } from "../../shared/defs/gameObjects/throwableDefs.ts";
import { math } from "../../shared/utils/math.ts";

export const DEFAULT_DUEL_BOOST = 100;
export const DEFAULT_DUEL_HELMET_LEVEL = 2 as const;
export const DEFAULT_DUEL_CHEST_LEVEL = 2 as const;
export const DEFAULT_DUEL_SCOPE = "4xscope" as const;
export const MAX_DUEL_THROWABLE_COUNT = 99;

export const DUEL_THROWABLE_IDS = [
    "frag",
    "mirv",
    "smoke",
    "strobe",
    "snowball",
    "potato",
] as const;

export type DuelThrowableId = (typeof DUEL_THROWABLE_IDS)[number];
export type DuelArmorLevel = 0 | 1 | 2 | 3;
export const DUEL_AI_DIFFICULTIES = [
    "normal",
    "hard",
    "pro",
    "legit",
    "forbidden",
] as const;
export type DuelAiDifficulty = (typeof DUEL_AI_DIFFICULTIES)[number];
export type PublicAiDifficulty = Exclude<DuelAiDifficulty, "forbidden">;
export type DuelThrowables = Record<DuelThrowableId, number>;
export const DUEL_SCOPE_TYPES = [
    "1xscope",
    "2xscope",
    "4xscope",
    "8xscope",
    "15xscope",
] as const;
export type DuelScope = (typeof DUEL_SCOPE_TYPES)[number];

export const DEFAULT_DUEL_ADRENALINE_ENABLED = true;
export const DEFAULT_DUEL_AI_ENABLED = false;
export const DEFAULT_DUEL_AI_DIFFICULTY: DuelAiDifficulty = "normal";

export const DEFAULT_DUEL_THROWABLES: DuelThrowables = {
    frag: 0,
    mirv: 0,
    smoke: 0,
    strobe: 0,
    snowball: 0,
    potato: 0,
};

const throwableNames: Record<DuelThrowableId, string> = {
    frag: "手榴弹",
    mirv: "MIRV 集束手雷",
    smoke: "烟雾弹",
    strobe: "红外空袭信标",
    snowball: "雪球",
    potato: "土豆",
};

export function isDuelBoost(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100;
}

export function isDuelAiDifficulty(value: unknown): value is DuelAiDifficulty {
    return (
        typeof value === "string"
        && DUEL_AI_DIFFICULTIES.includes(value as DuelAiDifficulty)
    );
}

export function isPublicAiDifficulty(value: unknown): value is PublicAiDifficulty {
    return isDuelAiDifficulty(value) && value !== "forbidden";
}

export function normalizeDuelAiDifficulty(value: unknown): DuelAiDifficulty {
    return isDuelAiDifficulty(value) ? value : DEFAULT_DUEL_AI_DIFFICULTY;
}

export function normalizeDuelBoost(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return DEFAULT_DUEL_BOOST;
    }
    return math.clamp(Math.round(value), 0, 100);
}

export function isDuelArmorLevel(value: unknown): value is DuelArmorLevel {
    return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 3;
}

export function normalizeDuelArmorLevel(value: unknown): DuelArmorLevel {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return DEFAULT_DUEL_HELMET_LEVEL;
    }
    return math.clamp(Math.round(value), 0, 3) as DuelArmorLevel;
}

export function isDuelScope(value: unknown): value is DuelScope {
    return typeof value === "string" && DUEL_SCOPE_TYPES.includes(value as DuelScope);
}

export function normalizeDuelScope(value: unknown): DuelScope {
    return isDuelScope(value) ? value : DEFAULT_DUEL_SCOPE;
}

export function isDuelThrowables(value: unknown): value is Partial<DuelThrowables> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.every(
        ([id, count]) =>
            DUEL_THROWABLE_IDS.includes(id as DuelThrowableId)
            && Number.isInteger(count)
            && (count as number) >= 0
            && (count as number) <= MAX_DUEL_THROWABLE_COUNT,
    );
}

export function normalizeDuelThrowables(value: unknown): DuelThrowables {
    const configured = value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    return Object.fromEntries(
        DUEL_THROWABLE_IDS.map((id) => {
            const count = configured[id];
            return [
                id,
                typeof count === "number" && Number.isFinite(count)
                    ? math.clamp(Math.round(count), 0, MAX_DUEL_THROWABLE_COUNT)
                    : 0,
            ];
        }),
    ) as DuelThrowables;
}

export function getDuelThrowableCatalog() {
    return DUEL_THROWABLE_IDS.map((id) => {
        const definition = ThrowableDefs[id];
        return {
            id,
            name: throwableNames[id],
            originalName: definition.name,
            image: `/img/loot/${definition.lootImg.sprite.replace(/\.img$/, ".svg")}`,
            maxCount: MAX_DUEL_THROWABLE_COUNT,
        };
    });
}
