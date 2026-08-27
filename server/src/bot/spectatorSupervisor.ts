import { type BotIntentCandidate, type BotIntentKind, type BotState, IntentTier } from "./decisionBrain.ts";

export type VisibleThreatResponseKind = "combat" | "counterfire" | "evade-and-search";

export interface VisibleThreatInterruptInput {
    enemyVisible: boolean;
    enemyDistance: number;
    hasUsableGun: boolean;
    usableWeaponRange?: number;
    reactionReady: boolean;
    millisecondsSinceDamage: number;
    currentState: BotState;
    pendingThrowableRelease: boolean;
    survivalEmergency: boolean;
    /** A real obstacle still blocks the attacker while medicine is active. */
    healingBehindHardCover?: boolean;
}

export interface VisibleThreatInterruptDecision {
    interrupt: boolean;
    response: VisibleThreatResponseKind | null;
    reason: string;
    critical: boolean;
}

const VOLUNTARY_STATES = new Set<BotState>([
    "loot",
    "break-crate",
    "regroup",
    "special",
    "explore",
    "cover",
    "hide",
]);

/**
 * Spectator-facing safety guard. The ordinary intent brain still handles normal
 * target selection, but this catches the visibly irrational cases a human
 * observer notices immediately: continuing to loot, regroup, service an
 * airdrop, or share ammo while a visible opponent is close enough to shoot.
 *
 * It deliberately respects reaction delay unless the bot has just taken damage
 * or the attacker is point blank. Gas, airstrike, and a primed throwable remain
 * higher priority because interrupting those actions can kill the bot outright.
 */
export function chooseVisibleThreatInterrupt(
    input: VisibleThreatInterruptInput,
): VisibleThreatInterruptDecision {
    if (
        input.survivalEmergency
        || input.pendingThrowableRelease
        || !input.enemyVisible
        || !Number.isFinite(input.enemyDistance)
    ) {
        return { interrupt: false, response: null, reason: "protected-priority", critical: false };
    }

    if (input.currentState === "heal" && Boolean(input.healingBehindHardCover)) {
        return {
            interrupt: false,
            response: null,
            reason: "protected-healing",
            critical: false,
        };
    }

    const recentlyDamaged = input.millisecondsSinceDamage <= 900;
    const hardHit = input.millisecondsSinceDamage <= 420;
    const pointBlank = input.enemyDistance <= (input.hasUsableGun ? 7.5 : 6.5);
    const voluntary = VOLUNTARY_STATES.has(input.currentState);
    const alreadyResponding = input.currentState === "combat"
        || input.currentState === "counterfire"
        || input.currentState === "retreat";

    // This supervisor exists to interrupt voluntary work. Re-entering it while
    // combat, counterfire, or a health-driven retreat is already active resets
    // the tactical brain every think tick and destroys combat/retreat
    // hysteresis. The active response owns subsequent target handling.
    if (alreadyResponding) {
        return {
            interrupt: false,
            response: null,
            reason: "threat-response-already-active",
            critical: false,
        };
    }

    if (!input.reactionReady && !recentlyDamaged && !pointBlank) {
        return { interrupt: false, response: null, reason: "reaction-delay", critical: false };
    }

    if (!input.hasUsableGun) {
        if (pointBlank || recentlyDamaged) {
            return {
                interrupt: true,
                response: "evade-and-search",
                reason: pointBlank ? "visible-point-blank-while-unarmed" : "damaged-while-unarmed",
                critical: pointBlank,
            };
        }
        return { interrupt: false, response: null, reason: "unarmed-threat-not-immediate", critical: false };
    }

    const voluntaryWeaponRange = Math.max(
        27,
        Math.min(64, Math.max(0, Number(input.usableWeaponRange) || 0) * 0.72),
    );
    const hardRange = hardHit
        ? Math.max(44, voluntaryWeaponRange)
        : recentlyDamaged
        ? Math.max(38, voluntaryWeaponRange)
        : voluntary
        ? voluntaryWeaponRange
        : 22;
    if (input.enemyDistance > hardRange) {
        return { interrupt: false, response: null, reason: "visible-threat-outside-interrupt-range", critical: false };
    }

    return {
        interrupt: true,
        response: hardHit ? "counterfire" : "combat",
        reason: hardHit
            ? "recent-damage-visible-attacker"
            : voluntary
            ? `visible-attacker-interrupts-${input.currentState}`
            : "close-visible-attacker",
        critical: hardHit || pointBlank,
    };
}

const SUPPRESSIBLE_KINDS = new Set<BotIntentKind>([
    "weapon-search",
    "special-role",
    "faction-order",
    "formation",
    "change-floor",
    "formation-change-floor",
    "enemy-search",
    "late-ring",
    "regroup",
    "explore",
]);

export function isSuppressibleIntent(candidate: BotIntentCandidate): boolean {
    return Boolean(
        candidate.targetKey
            && !candidate.critical
            && candidate.tier <= IntentTier.strategic + 1
            && SUPPRESSIBLE_KINDS.has(candidate.kind),
    );
}

export function strategicIntentBackoffMs(recoveryCount: number): number {
    const count = Math.max(1, Math.floor(recoveryCount));
    return Math.min(24_000, 4_000 + count * count * 1_100);
}

/**
 * Some strategic intents deliberately include a phase/step suffix. Suppressing
 * only the exact key lets the same failed enemy search reappear one step later.
 * Return both the exact identity and the stable family identity where needed.
 */
export function intentSuppressionKeys(
    candidate: Pick<BotIntentCandidate, "kind" | "targetKey">,
): string[] {
    const targetKey = candidate.targetKey;
    if (!targetKey) return [];
    if (candidate.kind === "enemy-search") {
        const parts = targetKey.split(":");
        if (parts.length >= 2) {
            return [targetKey, `${parts[0]}:${parts[1]}`];
        }
    }
    return [targetKey];
}

export interface OccludedTargetRetentionInput {
    difficulty: string;
    currentTarget: boolean;
    sameLayer: boolean;
    memoryAgeMs: number;
    rememberedPointOnScreen: boolean;
    proPeekActive: boolean;
    /** 搜打撤模式：玩家躲进建筑后允许更长时间追踪（进房搜人）。 */
    extractionMode?: boolean;
}

/**
 * Keeps only the last visually confirmed point through a very short occlusion.
 * It never authorizes firing. This prevents a tree edge or doorway from
 * resetting target acquisition and bouncing combat -> blindfire -> search on
 * adjacent ticks.
 * 搜打撤例外：玩家刚躲进房子（记忆还在）时，bot 需要持续追到门口/进房
 * 搜人，而不是半秒就放弃（否则 AI 永远不会进建筑打房内玩家）。
 */
export function shouldRetainOccludedTarget(
    input: OccludedTargetRetentionInput,
): boolean {
    if (
        !input.sameLayer
        || !input.rememberedPointOnScreen
        || !Number.isFinite(input.memoryAgeMs)
        || input.memoryAgeMs < 0
    ) {
        return false;
    }
    if (input.extractionMode) {
        // 搜打撤：追记忆点进房搜人——放宽到 6 秒，且不要求是当前目标
        // （刚看到玩家进房就持续追踪，直到到达记忆点/门口）。
        return input.memoryAgeMs <= 6000;
    }
    if (
        !input.currentTarget
        || !input.rememberedPointOnScreen
        || !Number.isFinite(input.memoryAgeMs)
        || input.memoryAgeMs < 0
    ) {
        return false;
    }
    const ordinaryMemoryMs = input.difficulty === "pro"
        ? 760
        : input.difficulty === "hard"
        ? 560
        : 420;
    const memoryMs = input.difficulty === "pro" && input.proPeekActive
        ? 1150
        : ordinaryMemoryMs;
    return input.memoryAgeMs <= memoryMs;
}

/**
 * Removes only repeatedly failed low-priority targets. Combat, healing, revive,
 * gas, airstrike, and critical decisions are never filtered by this layer.
 */
export function filterSuppressedIntents(
    candidates: readonly BotIntentCandidate[],
    suppressedUntil: ReadonlyMap<string, number>,
    timestamp: number,
): BotIntentCandidate[] {
    const filtered = candidates.filter((candidate) => {
        if (!isSuppressibleIntent(candidate)) return true;
        return intentSuppressionKeys(candidate).every(
            (key) => (suppressedUntil.get(key) ?? 0) <= timestamp,
        );
    });
    return filtered;
}
