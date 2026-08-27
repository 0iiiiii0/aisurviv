/**
 * Scoped-vision suppression strategy.
 *
 * A magnified scope (2x/4x/8x/15x) gives a tiny viewport. When the opponent
 * closes in, keeps the bot under fire, or stays visible but outside the narrow
 * scoped frame, the scope stops being an advantage - it is "suppressing" the
 * bot's own vision. The strategy drops one magnification level to widen the
 * field of view, and only restores the best owned scope once the fight is back
 * at a safe long range and the suppression is gone.
 */

export interface ScopeSuppressionInput {
    /** Currently equipped scope level (1x = 1, 4x = 4, ...). */
    scopeLevel: number;
    /** Distance to the active enemy; Infinity when no enemy is known. */
    enemyDistance: number;
    enemyVisible: boolean;
    /** Visible target currently inside the scoped viewport. */
    enemyOnScreen: boolean;
    /** True when the bot took damage very recently. */
    recentlyDamaged: boolean;
    /** True when a close ballistic threat is inbound. */
    closeThreat: boolean;
    /** Best scope level the bot owns (used when re-scoping). */
    maxOwnedScopeLevel: number;
    timestamp: number;
    lastScopeSwitchAt: number;
    scopeDropUntil: number;
}

export type ScopeSuppressionAction = "drop-scope" | "raise-scope" | "none";

export interface ScopeSuppressionDecision {
    action: ScopeSuppressionAction;
    reason: string;
}

/** Returns the best actually-owned scope below the currently equipped level. */
export function highestOwnedScopeBelow(
    currentLevel: number,
    ownedLevels: readonly number[],
): number | null {
    const current = Math.max(1, Number(currentLevel) || 1);
    let best = -Infinity;
    for (const rawLevel of ownedLevels) {
        const level = Number(rawLevel);
        if (Number.isFinite(level) && level >= 1 && level < current) {
            best = Math.max(best, level);
        }
    }
    return Number.isFinite(best) ? best : null;
}

/** Distance below which a magnification scope is a liability. */
export function scopeCloseBreakpoint(level: number): number {
    return 9 + Math.max(1, level) * 2.4;
}

export function decideScopeAction(input: ScopeSuppressionInput): ScopeSuppressionDecision {
    const level = Math.max(1, Number(input.scopeLevel) || 1);
    const enemyDistance = Number.isFinite(input.enemyDistance)
        ? input.enemyDistance
        : Infinity;

    const suppressed = level > 1
        && (enemyDistance < scopeCloseBreakpoint(level)
            || (input.enemyVisible && !input.enemyOnScreen)
            || input.recentlyDamaged
            || input.closeThreat);

    if (suppressed && input.timestamp >= input.lastScopeSwitchAt) {
        return {
            action: "drop-scope",
            reason: enemyDistance < scopeCloseBreakpoint(level)
                ? "close-enemy"
                : input.enemyVisible && !input.enemyOnScreen
                ? "off-screen-target"
                : "under-fire",
        };
    }

    if (
        !suppressed
        && input.timestamp >= input.scopeDropUntil
        && input.timestamp >= input.lastScopeSwitchAt
        && level < input.maxOwnedScopeLevel
        && enemyDistance > scopeCloseBreakpoint(Math.max(2, level + 1)) + 8
    ) {
        return { action: "raise-scope", reason: "safe-long-range" };
    }

    return { action: "none", reason: suppressed ? "suppressed-cooldown" : "stable" };
}
