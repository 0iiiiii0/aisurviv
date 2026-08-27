export type DuelThrowableKind = "" | "smoke" | "strobe" | "mirv" | "frag";

export interface DuelThrowableTacticInput {
    hasSmoke: boolean;
    hasStrobe: boolean;
    hasMirv: boolean;
    hasFrag: boolean;
    difficulty: string;
    health: number;
    enemyDistance: number;
    underFire: boolean;
    reloadingOrHealing: boolean;
    hardCoverNearEnemy: boolean;
    millisecondsSinceDamage: number;
    gasDanger: boolean;
    airstrikeDanger: boolean;
}

/**
 * Chooses the tactical purpose before trajectory solving. Geometry, fuse and
 * self-damage validation remain mandatory after this selection.
 */
export function chooseDuelThrowableKind(
    input: DuelThrowableTacticInput,
): DuelThrowableKind {
    if (input.gasDanger || input.airstrikeDanger) return "";

    const defensiveSmokeNeeded = input.hasSmoke
        && input.enemyDistance >= 8
        && input.enemyDistance <= 32
        && input.underFire
        && (input.health < 43 || (input.health < 58 && input.reloadingOrHealing));
    if (defensiveSmokeNeeded) return "smoke";

    // Do not begin an offensive throwing animation during immediate damage.
    if (input.millisecondsSinceDamage < 320) return "";
    if (input.enemyDistance < 14.5 || input.enemyDistance > 39) return "";

    if (
        input.hasStrobe
        && input.difficulty !== "normal"
        && input.enemyDistance >= 18
        && (input.hardCoverNearEnemy || input.enemyDistance >= 24)
    ) {
        return "strobe";
    }

    if (
        input.hasMirv
        && input.enemyDistance >= 19
        && input.enemyDistance <= 36
        && (input.hardCoverNearEnemy || input.enemyDistance >= 24)
    ) {
        return "mirv";
    }

    if (
        input.hasFrag
        && input.enemyDistance <= 36
        && (input.hardCoverNearEnemy || input.enemyDistance >= 18)
    ) {
        return "frag";
    }

    return "";
}

export function defensiveSmokeDistance(enemyDistance: number): number {
    return Math.max(2.8, Math.min(5.5, enemyDistance * 0.35));
}
