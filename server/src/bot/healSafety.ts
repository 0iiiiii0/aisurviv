export interface HealSafetyContext {
    health: number;
    enemyDistance: number;
    enemyHasLineOfSight: boolean;
    inHardCover: boolean;
    indoors: boolean;
    outsideGas: boolean;
    underAirstrike: boolean;
    ballisticPressure: boolean;
    millisecondsSinceDamage: number;
    actionAlreadyActive?: boolean;
}

export interface HealSafetyDecision {
    canHeal: boolean;
    mustSeekCover: boolean;
    cancelActiveAction: boolean;
    reason:
        | "safe"
        | "gas"
        | "airstrike"
        | "enemy-line-of-sight"
        | "point-blank-threat"
        | "recent-damage"
        | "ballistic-pressure"
        | "needs-cover";
}

/**
 * Healing is a committed action. The server allows movement at reduced speed,
 * but combat healing is permitted only after line-of-sight has been broken by
 * hard cover and after a meaningful
 * no-damage window. Being inside a building is not cover by itself: an enemy in
 * the same room can still punish the stationary action. Critical HP increases urgency to
 * reach cover; it does not allow face-tanking a medkit in front of an enemy.
 */
export function assessHealSafety(context: HealSafetyContext): HealSafetyDecision {
    const closeCombat = context.enemyDistance < 30;
    const nearbyCombat = context.enemyDistance < 90;
    const protectedPosition = context.inHardCover;
    const recentDamageLimit = context.actionAlreadyActive
        ? closeCombat || context.ballisticPressure
            ? 1350
            : 700
        : nearbyCombat || context.ballisticPressure
        ? 1800
        : 1050;
    const combatPressure = context.enemyDistance < 110
        || context.enemyHasLineOfSight
        || context.ballisticPressure
        || context.millisecondsSinceDamage < 3600;

    if (context.outsideGas) {
        return {
            canHeal: false,
            mustSeekCover: false,
            cancelActiveAction: true,
            reason: "gas",
        };
    }
    if (context.underAirstrike) {
        return {
            canHeal: false,
            mustSeekCover: false,
            cancelActiveAction: true,
            reason: "airstrike",
        };
    }
    if (context.enemyDistance < 30 && !protectedPosition) {
        return {
            canHeal: false,
            mustSeekCover: true,
            cancelActiveAction: true,
            reason: "point-blank-threat",
        };
    }
    if (context.enemyHasLineOfSight) {
        return {
            canHeal: false,
            mustSeekCover: true,
            cancelActiveAction: true,
            reason: "enemy-line-of-sight",
        };
    }
    if (context.millisecondsSinceDamage < recentDamageLimit) {
        return {
            canHeal: false,
            mustSeekCover: combatPressure,
            cancelActiveAction: Boolean(context.actionAlreadyActive),
            reason: "recent-damage",
        };
    }
    if (context.ballisticPressure && !protectedPosition) {
        return {
            canHeal: false,
            mustSeekCover: true,
            cancelActiveAction: Boolean(context.actionAlreadyActive),
            reason: "ballistic-pressure",
        };
    }
    if (nearbyCombat && !protectedPosition) {
        return {
            canHeal: false,
            mustSeekCover: true,
            cancelActiveAction: Boolean(context.actionAlreadyActive),
            reason: "needs-cover",
        };
    }
    // Indoors is only acceptable when there is no nearby/recent combat at all.
    // It is useful against distant, unknown threats but must never substitute for
    // an actual wall between the bot and a nearby opponent.
    if (
        context.indoors
        && !protectedPosition
        && (context.enemyDistance < 110 || context.millisecondsSinceDamage < 4200)
    ) {
        return {
            canHeal: false,
            mustSeekCover: true,
            cancelActiveAction: Boolean(context.actionAlreadyActive),
            reason: "needs-cover",
        };
    }
    if (combatPressure && !protectedPosition && !context.indoors) {
        return {
            canHeal: false,
            mustSeekCover: true,
            cancelActiveAction: Boolean(context.actionAlreadyActive),
            reason: "needs-cover",
        };
    }
    return {
        canHeal: true,
        mustSeekCover: false,
        cancelActiveAction: false,
        reason: "safe",
    };
}
