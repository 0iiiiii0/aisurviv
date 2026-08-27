export type ResourcePursuitReason = "commitment-timeout" | "no-distance-progress" | null;

export interface ResourcePursuitEvaluationInput {
    startedAt: number;
    progressAt: number;
    bestDistance: number;
    distance: number;
    timestamp: number;
    commitmentMs: number;
    progressTimeoutMs: number;
    progressThreshold?: number;
    /**
     * The bot has reached a legal pickup/attack position and the resource
     * handler is now responsible for interaction retries.
     */
    engaged?: boolean;
}

export interface ResourcePursuitEvaluation {
    bestDistance: number;
    progressAt: number;
    progressed: boolean;
    expired: boolean;
    reason: ResourcePursuitReason;
}

export type PickupRetryDecision = "attempt" | "wait" | "abandon";

/**
 * Bound pickup retries without extending the acknowledgement deadline on every
 * decision tick. Once the retry budget is exhausted the caller must stop
 * emitting Loot inputs, wait for the authoritative inventory/object update,
 * then abandon the target if no update arrived.
 */
export function evaluatePickupRetry(input: {
    attemptCount: number;
    retryLimit: number;
    lastAttemptAt: number;
    timestamp: number;
    retryIntervalMs?: number;
    acknowledgementMs?: number;
}): PickupRetryDecision {
    const retryLimit = Math.max(1, Math.floor(input.retryLimit));
    const retryIntervalMs = Math.max(1, input.retryIntervalMs ?? 70);
    const acknowledgementMs = Math.max(retryIntervalMs, input.acknowledgementMs ?? 650);
    if (input.attemptCount >= retryLimit) {
        return input.lastAttemptAt > 0
            && input.timestamp - input.lastAttemptAt >= acknowledgementMs
            ? "abandon"
            : "wait";
    }
    return input.lastAttemptAt <= 0
        || input.timestamp - input.lastAttemptAt >= retryIntervalMs
        ? "attempt"
        : "wait";
}

export function evaluateResourcePursuit(
    input: ResourcePursuitEvaluationInput,
): ResourcePursuitEvaluation {
    const threshold = Math.max(0.1, input.progressThreshold ?? 0.65);
    const distanceProgress = input.distance <= input.bestDistance - threshold;
    const progressed = distanceProgress || Boolean(input.engaged);
    const bestDistance = distanceProgress ? input.distance : input.bestDistance;
    const progressAt = progressed ? input.timestamp : input.progressAt;
    const commitmentExpired = !input.engaged
        && input.commitmentMs > 0
        && input.timestamp - input.startedAt >= input.commitmentMs;
    const progressExpired = input.progressTimeoutMs > 0 && input.timestamp - progressAt >= input.progressTimeoutMs;
    return {
        bestDistance,
        progressAt,
        progressed,
        expired: commitmentExpired || progressExpired,
        reason: commitmentExpired
            ? "commitment-timeout"
            : progressExpired
            ? "no-distance-progress"
            : null,
    };
}

export function nextRepeatedRecoveryCount(input: {
    targetKey: string;
    previousTargetKey: string;
    previousCount: number;
    timestamp: number;
    previousAt: number;
    memoryMs?: number;
}): number {
    const same = input.targetKey === input.previousTargetKey
        && input.timestamp - input.previousAt < (input.memoryMs ?? 10_000);
    return same ? Math.min(8, input.previousCount + 1) : 1;
}

export function evaluateRecoveryEscalation(input: {
    targetKey: string;
    previousTargetKey: string;
    previousCount: number;
    currentLevel: number;
    timestamp: number;
    previousAt: number;
    memoryMs?: number;
}): { repeated: boolean; count: number; level: number } {
    const memoryMs = input.memoryMs ?? 6500;
    const repeated = input.targetKey === input.previousTargetKey
        && input.timestamp - input.previousAt < memoryMs;
    const count = nextRepeatedRecoveryCount({
        targetKey: input.targetKey,
        previousTargetKey: input.previousTargetKey,
        previousCount: input.previousCount,
        timestamp: input.timestamp,
        previousAt: input.previousAt,
        memoryMs,
    });
    return {
        repeated,
        count,
        level: Math.min(
            5,
            Math.max(repeated ? input.currentLevel + 1 : 1, count),
        ),
    };
}

const NAVIGATION_RECOVERY_PROTECTED_STATES = new Set([
    "combat",
    "counterfire",
    "retreat",
    "heal",
    "revive",
]);

/** Gas and airstrike paths still need oscillation detection and door recovery. */
export function canRunNavigationRecovery(state: string): boolean {
    return !NAVIGATION_RECOVERY_PROTECTED_STATES.has(state);
}

export interface DurableRecoveryProgressInput {
    elapsedMs: number;
    displacement: number;
    startObjectiveDistance: number;
    currentObjectiveDistance: number;
    minimumElapsedMs?: number;
    minimumDisplacement?: number;
    minimumObjectiveProgress?: number;
    localEscapeDistance?: number;
}

/**
 * A short lateral probe is not proof that a route recovered. Require the bot
 * to keep moving for a minimum window and either make real progress toward the
 * recovery objective or leave the local trap area altogether.
 */
export function hasDurableRecoveryProgress(input: DurableRecoveryProgressInput): boolean {
    const elapsedMs = Number(input.elapsedMs);
    const displacement = Number(input.displacement);
    const startDistance = Number(input.startObjectiveDistance);
    const currentDistance = Number(input.currentObjectiveDistance);
    if (
        !Number.isFinite(elapsedMs)
        || !Number.isFinite(displacement)
        || !Number.isFinite(startDistance)
        || !Number.isFinite(currentDistance)
    ) {
        return false;
    }

    const minimumElapsedMs = Math.max(0, input.minimumElapsedMs ?? 900);
    const minimumDisplacement = Math.max(0.1, input.minimumDisplacement ?? 2.1);
    if (elapsedMs < minimumElapsedMs || displacement < minimumDisplacement) {
        return false;
    }

    const objectiveProgress = startDistance - currentDistance;
    return (
        objectiveProgress >= Math.max(0.1, input.minimumObjectiveProgress ?? 0.9)
        || displacement >= Math.max(minimumDisplacement, input.localEscapeDistance ?? 7.5)
    );
}
