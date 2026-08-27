import type { PublicAiDifficulty } from "./duelLoadout.ts";

export const PUBLIC_AI_DIFFICULTIES = [
    "normal",
    "hard",
    "pro",
    "legit",
] as const satisfies readonly PublicAiDifficulty[];

export type AiDifficultyRatios = Record<PublicAiDifficulty, number>;

export const ALL_AI_DIFFICULTIES = [
    "normal",
    "hard",
    "pro",
    "legit",
    "forbidden",
] as const;

export type AnyAiDifficulty = (typeof ALL_AI_DIFFICULTIES)[number];
export type AiThinkIntervals = Record<AnyAiDifficulty, number>;

export const DEFAULT_AI_THINK_INTERVALS: AiThinkIntervals = {
    normal: 100,
    hard: 60,
    pro: 28,
    legit: 6,
    forbidden: 4,
};

export function normalizeAiThinkIntervals(value: unknown): AiThinkIntervals {
    const record = value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    return Object.fromEntries(
        ALL_AI_DIFFICULTIES.map((difficulty) => {
            const parsed = Number(record[difficulty]);
            return [
                difficulty,
                Number.isFinite(parsed)
                    ? Math.min(250, Math.max(1, Math.round(parsed)))
                    : DEFAULT_AI_THINK_INTERVALS[difficulty],
            ];
        }),
    ) as AiThinkIntervals;
}

export function isAiThinkIntervals(value: unknown): value is AiThinkIntervals {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return ALL_AI_DIFFICULTIES.every((difficulty) =>
        Number.isInteger(record[difficulty])
        && Number(record[difficulty]) >= 1
        && Number(record[difficulty]) <= 250
    );
}

export const DEFAULT_AI_DIFFICULTY_RATIOS: AiDifficultyRatios = {
    normal: 50,
    hard: 33,
    pro: 17,
    legit: 0,
};

export function normalizeAiDifficultyRatios(value: unknown): AiDifficultyRatios {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { ...DEFAULT_AI_DIFFICULTY_RATIOS };
    }
    const record = value as Record<string, unknown>;
    const normalized = Object.fromEntries(
        PUBLIC_AI_DIFFICULTIES.map((difficulty) => {
            const ratio = Number(record[difficulty]);
            return [
                difficulty,
                Number.isFinite(ratio)
                    ? Math.min(100, Math.max(0, Math.round(ratio)))
                    : DEFAULT_AI_DIFFICULTY_RATIOS[difficulty],
            ];
        }),
    ) as AiDifficultyRatios;
    const total = PUBLIC_AI_DIFFICULTIES.reduce(
        (sum, difficulty) => sum + normalized[difficulty],
        0,
    );
    return total === 100
        ? normalized
        : { ...DEFAULT_AI_DIFFICULTY_RATIOS };
}

export function isAiDifficultyRatios(value: unknown): value is AiDifficultyRatios {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    if (
        Object.keys(record).some(
            (key) => !PUBLIC_AI_DIFFICULTIES.includes(key as PublicAiDifficulty),
        )
    ) {
        return false;
    }
    return (
        PUBLIC_AI_DIFFICULTIES.every(
            (difficulty) =>
                Number.isInteger(record[difficulty])
                && Number(record[difficulty]) >= 0
                && Number(record[difficulty]) <= 100,
        )
        && PUBLIC_AI_DIFFICULTIES.reduce(
                (sum, difficulty) => sum + Number(record[difficulty]),
                0,
            ) === 100
    );
}

function buildWeightedRotation(ratios: AiDifficultyRatios): PublicAiDifficulty[] {
    const rotation: PublicAiDifficulty[] = [];
    const current = Object.fromEntries(
        PUBLIC_AI_DIFFICULTIES.map((difficulty) => [difficulty, 0]),
    ) as AiDifficultyRatios;

    for (let slot = 0; slot < 100; slot++) {
        let selected: PublicAiDifficulty = PUBLIC_AI_DIFFICULTIES[0];
        for (const difficulty of PUBLIC_AI_DIFFICULTIES) {
            current[difficulty] += ratios[difficulty];
            if (current[difficulty] > current[selected]) selected = difficulty;
        }
        current[selected] -= 100;
        rotation.push(selected);
    }
    return rotation;
}

export function planMixedBotDifficulties(
    count: number,
    cursor = 0,
    ratios: AiDifficultyRatios = DEFAULT_AI_DIFFICULTY_RATIOS,
): { difficulties: PublicAiDifficulty[]; nextCursor: number } {
    const normalizedCount = Math.max(0, Math.trunc(count));
    const normalizedCursor = Math.max(0, Math.trunc(cursor));
    const rotation = buildWeightedRotation(normalizeAiDifficultyRatios(ratios));
    const difficulties = Array.from(
        { length: normalizedCount },
        (_, index) => rotation[(normalizedCursor + index) % rotation.length],
    );
    return {
        difficulties,
        nextCursor: normalizedCursor + normalizedCount,
    };
}
