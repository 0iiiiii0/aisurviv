export interface PrecisionStopContext {
    stopToShoot: boolean;
    meleeWeapon: boolean;
    targetDistance: number;
    weaponRange: number;
    lineClear: boolean;
    healthSafe: boolean;
    recentlyDamaged: boolean;
    underAirstrike: boolean;
    nearbyEnemyCount: number;
}

export interface TriggerContext {
    duelMode: boolean;
    reactionReady: boolean;
    inRange: boolean;
    lineClear: boolean;
    ammoReady: boolean;
    shootConfidence: number;
    randomRoll: number;
}

export interface HighTierCombatActivationContext {
    difficulty: string;
    duelMode: boolean;
    contextFresh: boolean;
    contextMatchesBot: boolean;
    contextMatchesGame: boolean;
    perceptionMatches: boolean;
    hasBotSnapshot: boolean;
    hasLiveEnemy: boolean;
}

/**
 * LEGIT/HACKER used to be routed through their authoritative combat planner
 * only in the 1v1 map. In an ordinary match they may take over while a fresh
 * enemy snapshot exists, but must yield immediately when it does not so the
 * normal looting, gas, room-pursuit and exploration branches keep running.
 */
export function shouldActivateHighTierCombatController(
    context: HighTierCombatActivationContext,
): boolean {
    if (context.difficulty !== "legit" && context.difficulty !== "forbidden") {
        return false;
    }
    // Preserve the original duel behaviour, including last-seen searching and
    // waiting for the first server context packet.
    if (context.duelMode) return true;
    return Boolean(
        context.contextFresh
            && context.contextMatchesBot
            && context.contextMatchesGame
            && context.perceptionMatches
            && context.hasBotSnapshot
            && context.hasLiveEnemy,
    );
}

/**
 * Hard and stronger bots simulate repeatedly clicking/holding the trigger.
 * The authoritative WeaponManager remains the sole fire-rate limiter, so this
 * reaches (but can never exceed) each weapon definition's real rate of fire.
 */
export function usesMaximumTriggerCadence(difficulty: string): boolean {
    return (
        difficulty === "hard"
        || difficulty === "pro"
        || difficulty === "legit"
        || difficulty === "forbidden"
    );
}

export function triggerCadenceReady(input: {
    difficulty: string;
    automatic: boolean;
    duelMode: boolean;
    elapsedSinceRequestMs: number;
    fireDelaySeconds: number;
}): boolean {
    if (input.automatic || !input.duelMode) return true;
    if (usesMaximumTriggerCadence(input.difficulty)) return true;
    const fireDelayMs = Math.max(55, Number(input.fireDelaySeconds) * 1000 || 180);
    return Math.max(0, Number(input.elapsedSinceRequestMs) || 0) >= fireDelayMs;
}

export function lastSeenBlindFireDurationMs(difficulty: string): number {
    switch (difficulty) {
        case "legit":
            return 850;
        case "pro":
            return 720;
        case "hard":
            return 560;
        case "normal":
            return 420;
        default:
            return 0;
    }
}

export function shouldStartLastSeenBlindFire(input: {
    difficulty: string;
    targetId: number;
    sameLayer: boolean;
    observationAgeMs: number;
    lastSeenPointInViewport: boolean;
    aimPoint: { x: number; y: number };
}): boolean {
    // This is evaluated once when visual contact is lost. The resulting burst
    // aims at a copied last-visible point; it never follows the authoritative
    // off-screen player coordinate and does not revalidate every fire packet.
    const age = Math.max(0, Number(input.observationAgeMs) || 0);
    const maximumTransitionAge = Math.min(
        260,
        lastSeenBlindFireDurationMs(input.difficulty),
    );
    return Boolean(
        lastSeenBlindFireDurationMs(input.difficulty) > 0
            && input.targetId > 0
            && input.sameLayer
            && input.lastSeenPointInViewport
            && Number.isFinite(Number(input.aimPoint?.x))
            && Number.isFinite(Number(input.aimPoint?.y))
            && age <= maximumTransitionAge,
    );
}

export function shouldInterruptCombatReload(input: {
    reloadActive: boolean;
    clipAmmo: number;
    targetVisible: boolean;
    targetInRange: boolean;
    lineClear: boolean;
}): boolean {
    return Boolean(
        input.reloadActive
            && Number(input.clipAmmo) > 0
            && input.targetVisible
            && input.targetInRange
            && input.lineClear,
    );
}

/**
 * A precision weapon may only root the bot when a real shot is currently
 * possible. This prevents the failure where a bot selected a long-range
 * weapon, aimed at the opponent, stopped moving, but could not actually fire.
 */
export function shouldStopForPrecisionShot(context: PrecisionStopContext): boolean {
    return Boolean(
        context.stopToShoot
            && !context.meleeWeapon
            && context.targetDistance <= Math.max(1, context.weaponRange)
            && context.lineClear
            && context.healthSafe
            && !context.recentlyDamaged
            && !context.underAirstrike
            && context.nearbyEnemyCount === 0,
    );
}

/**
 * Old versions rolled shootConfidence every decision pass. A bad roll exactly
 * when aim alignment completed could leave a bot visually tracking a player but
 * never sending a usable shot. Accuracy and difficulty are already represented
 * by reaction time, aim jitter, lead quality, cadence and movement, so the hard
 * trigger gate is deterministic once all physical checks pass.
 */
export function shouldPullTrigger(context: TriggerContext): boolean {
    void context.duelMode;
    void context.shootConfidence;
    void context.randomRoll;
    return Boolean(
        context.reactionReady
            && context.inRange
            && context.lineClear
            && context.ammoReady,
    );
}

/**
 * Stale object-pool coordinates must not become long-range wall information.
 * At close range a slightly older sample is tolerable; at rifle/scope ranges the
 * enemy has to have appeared in the bot's current camera very recently.
 */
export function isFreshCombatObservation(
    targetDistance: number,
    observationAgeMs: number,
    currentScopeLevel = 1,
): boolean {
    const distance = Math.max(0, Number(targetDistance) || 0);
    const age = Math.max(0, Number(observationAgeMs) || 0);
    const scope = Math.max(1, Number(currentScopeLevel) || 1);

    if (distance <= 18) return age <= 1250;
    if (distance <= 34) return age <= 700;
    // Larger scopes update a wider scene, but still require a current visible
    // sample rather than a backpack scope or old object coordinate.
    const longRangeFreshness = Math.max(180, Math.min(330, 230 + scope * 6));
    return age <= longRangeFreshness;
}
