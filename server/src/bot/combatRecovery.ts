export interface RecoveryThreatInput {
    survivalLocked: boolean;
    hasEnemy: boolean;
    enemyDead: boolean;
    teammate: boolean;
    sameLayer: boolean;
    onScreen: boolean;
    lineClear: boolean;
    weaponKind: "gun" | "melee" | "other";
    ammo: number;
    distance: number;
    weaponRange: number;
}

/**
 * An old navigation-recovery command must never erase a valid close combat
 * trigger. Survival escape remains higher priority; otherwise an on-screen,
 * hittable opponent interrupts door/unstuck recovery immediately.
 */
export function shouldInterruptRecoveryForThreat(input: RecoveryThreatInput): boolean {
    if (input.survivalLocked) return false;
    if (!input.hasEnemy || input.enemyDead || input.teammate || !input.sameLayer) return false;
    if (!input.onScreen || !input.lineClear) return false;
    if (!Number.isFinite(input.distance) || input.distance < 0) return false;
    if (input.weaponKind === "gun") {
        return input.ammo > 0 && input.distance <= input.weaponRange + 0.5;
    }
    if (input.weaponKind === "melee") {
        return input.distance <= input.weaponRange;
    }
    return false;
}
