export type DifficultyName = "normal" | "hard" | "pro" | "legit" | "forbidden";

export interface DifficultyProfile {
    thinkIntervalMs: number;
    reactionMs: number;
    aimJitterRad: number;
    leadFactor: number;
    targetMemoryMs: number;
    combatScanRange: number;
    shootConfidence: number;
    strafePeriodMs: number;
    retreatHealth: number;
    healEnemyRange: number;
}

/**
 * Keep the original surviv.io-main combat floor for Normal while preserving
 * the faster V35+ profiles above it. Normal is the default duel selection and
 * half of the public bot mix, so weakening it below the parent build makes the
 * whole advanced combat system appear regressed even when Pro/Legit/Hacker
 * retain their newer tactics.
 */
export const DIFFICULTY_PROFILES: Record<DifficultyName, DifficultyProfile> = {
    normal: {
        thinkIntervalMs: 100,
        reactionMs: 120,
        aimJitterRad: 0.036,
        leadFactor: 0.94,
        targetMemoryMs: 1500,
        combatScanRange: 88,
        shootConfidence: 0.92,
        strafePeriodMs: 760,
        retreatHealth: 32,
        healEnemyRange: 36,
    },
    hard: {
        thinkIntervalMs: 60,
        reactionMs: 55,
        aimJitterRad: 0.012,
        leadFactor: 1,
        targetMemoryMs: 2100,
        combatScanRange: 112,
        shootConfidence: 0.98,
        strafePeriodMs: 600,
        retreatHealth: 40,
        healEnemyRange: 46,
    },
    pro: {
        thinkIntervalMs: 28,
        reactionMs: 12,
        aimJitterRad: 0.0024,
        leadFactor: 1.07,
        targetMemoryMs: 3200,
        combatScanRange: 138,
        shootConfidence: 0.999,
        strafePeriodMs: 390,
        retreatHealth: 48,
        healEnemyRange: 58,
    },
    legit: {
        thinkIntervalMs: 6,
        reactionMs: 0,
        aimJitterRad: 0,
        leadFactor: 1.08,
        targetMemoryMs: 4500,
        combatScanRange: 10_000,
        shootConfidence: 1,
        strafePeriodMs: 220,
        retreatHealth: 52,
        healEnemyRange: 75,
    },
    forbidden: {
        thinkIntervalMs: 4,
        reactionMs: 0,
        aimJitterRad: 0,
        leadFactor: 1.08,
        targetMemoryMs: 60_000,
        combatScanRange: 10_000,
        shootConfidence: 1,
        strafePeriodMs: 220,
        retreatHealth: 46,
        healEnemyRange: 84,
    },
};
