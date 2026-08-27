export interface FactionUnarmedCombatInput {
    factionMode: boolean;
    usableGunCount: number;
    /**
     * True when at least one firearm carries enough ammo to actually fight.
     * Optional for backward compatibility: defaults to "armed".
     */
    combatAmmoSufficient?: boolean;
    enemyDistance: number;
    enemyUsesMelee: boolean;
    enemyMeleeReach: number;
}

/**
 * A bot without a usable firearm - or with a firearm that is out of ammo -
 * rotates to weapons/ammo instead of volunteering for a fight, in every mode,
 * not just 50v50. Even at point blank it evades while continuing the search;
 * the only exception is an enemy meleeing it, which still forces self-defense.
 */
export function factionUnarmedCombatPolicy(input: FactionUnarmedCombatInput): {
    prioritizeWeaponSearch: boolean;
    immediateMeleeThreat: boolean;
    allowCombat: boolean;
} {
    const ammoReady = input.combatAmmoSufficient ?? input.usableGunCount > 0;
    const prioritizeWeaponSearch = input.usableGunCount <= 0 || !ammoReady;
    const immediateMeleeThreat = input.enemyUsesMelee
        && input.enemyMeleeReach > 0
        && input.enemyDistance <= input.enemyMeleeReach;
    return {
        prioritizeWeaponSearch,
        immediateMeleeThreat,
        allowCombat: !prioritizeWeaponSearch,
    };
}

export type CombatReadiness = 0 | 1 | 2;
export type GunTier = "S+" | "S" | "A" | "B" | "C" | "D" | "F" | null;

export interface UnarmedLootPriorityInput {
    itemKind: string;
    /** False for utility launchers such as flare guns. */
    combatCapableGun?: boolean;
    /** True only when this ammo feeds a firearm already owned by the bot. */
    matchingOwnedGunAmmo?: boolean;
}

/**
 * While no firearm can currently fire, only a loose gun or ammo that revives
 * an owned dry gun may pre-empt the strategic weapon search. Armour, medicine,
 * backpacks and unrelated ammo are useful later, but none solves the immediate
 * inability to fight.
 */
export function unarmedLootRestoresCombat(input: UnarmedLootPriorityInput): boolean {
    return (
        (input.itemKind === "gun" && input.combatCapableGun !== false)
        || (input.itemKind === "ammo" && Boolean(input.matchingOwnedGunAmmo))
    );
}

export interface UnarmedCratePriorityInput {
    distance: number;
    expectedValue: number;
    estimatedHits: number;
    opening: boolean;
}

/**
 * Breaking a container is only a first-gun shortcut when it is a cheap, nearby
 * and credible source. This keeps ordinary/far fixtures below weapon-search and
 * prevents an unarmed bot from chaining containers for minutes.
 */
export function shouldPrioritizeUnarmedCrate(input: UnarmedCratePriorityInput): boolean {
    const distance = Number(input.distance);
    const value = Number(input.expectedValue);
    const hits = Number(input.estimatedHits);
    if (
        !Number.isFinite(distance)
        || !Number.isFinite(value)
        || !Number.isFinite(hits)
        || distance < 0
        || hits <= 0
    ) {
        return false;
    }

    const closeEfficientSource = distance <= 7.5 && value >= 18 && hits <= 14;
    const openingHighValueSource = input.opening && distance <= 12 && value >= 30 && hits <= 18;
    return closeEfficientSource || openingHighValueSource;
}

/**
 * Combat readiness tiers:
 *   0 - no usable firearm (no gun or no ammo at all);
 *   1 - only a weak firearm (C/D/F tier guns: pistols, water guns, utility
 *       tools) - "没有好枪";
 *   2 - at least one B-tier-or-better gun with ammo.
 */
export function combatReadiness(input: {
    usableGunCount: number;
    bestGunTier: GunTier;
    combatAmmoSufficient: boolean;
}): CombatReadiness {
    if (input.usableGunCount <= 0 || !input.combatAmmoSufficient) return 0;
    const tier = input.bestGunTier;
    if (tier === null || tier === "F" || tier === "D" || tier === "C") return 1;
    return 2;
}

export interface UnderEquippedEnemyDecision {
    /** Move away from the hostile while rotating toward a better weapon. */
    evade: boolean;
    /** Voluntarily fight this specific hostile. */
    allowCombat: boolean;
    /** Only fight when cornered / forced (melee or point blank). */
    selfDefenseOnly: boolean;
}

/**
 * Encounter rules for under-equipped bots (readiness 0 or 1):
 *  - readiness 0 (no gun): never volunteer for combat; evade while searching;
 *    fight only when an enemy is meleeing us at reach.
 *  - readiness 1 (weak gun only): fight back only when the enemy is also
 *    unarmed (melee-only, we can out-range fists) or at point blank; otherwise
 *    evade inside ~26u and keep rotating to a better weapon.
 *  - readiness 2: normal combat behaviour (no restrictions).
 */
export function underEquippedEnemyPolicy(input: {
    readiness: CombatReadiness;
    enemyDistance: number;
    enemyUsesMelee: boolean;
    enemyMeleeReach: number;
}): UnderEquippedEnemyDecision {
    if (input.readiness === 2) {
        return { evade: false, allowCombat: true, selfDefenseOnly: false };
    }
    const meleeThreat = input.enemyUsesMelee
        && input.enemyMeleeReach > 0
        && input.enemyDistance <= input.enemyMeleeReach;
    const pointBlank = input.enemyDistance <= 4.8;
    // With any firearm (readiness 1) an enemy that is only melee-armed can be
    // kited and out-ranged; with fists only (readiness 0) we still avoid the
    // melee trade unless it is already in our face.
    const kitableMeleeEnemy = input.readiness === 1
        && input.enemyUsesMelee
        && input.enemyDistance <= 9;
    const allowCombat = meleeThreat || pointBlank || kitableMeleeEnemy;
    return {
        evade: !allowCombat && input.enemyDistance <= 26,
        allowCombat,
        selfDefenseOnly: !allowCombat,
    };
}

export const lootSourceMemoryMs = (sourceTier: string): number => sourceTier.includes("airdrop") ? 45_000 : 5_200;

export const lootSourceAssociationRadius = (sourceTier: string): number => sourceTier.includes("airdrop") ? 32 : 14;

export interface EmptyFlareDropState {
    key: string;
    firstEmptyAt: number;
    retryAt: number;
}

export interface EmptyFlareDropContext {
    pairedAmmoNearby?: boolean;
    acquisitionGraceMs?: number;
}

/**
 * Keeps a newly acquired empty flare gun long enough to collect a flare that
 * spawned beside it. This prevents the gun/ammo pickup race from becoming a
 * drop-pickup loop while still discarding a genuinely useless empty launcher.
 */
export function emptyFlareDropDecision(
    current: EmptyFlareDropState,
    flareKey: string,
    timestamp: number,
    context: EmptyFlareDropContext = {},
): { shouldDrop: boolean; next: EmptyFlareDropState } {
    const cleared = { key: "", firstEmptyAt: 0, retryAt: 0 };
    if (!flareKey) return { shouldDrop: false, next: cleared };

    const graceMs = Math.max(250, context.acquisitionGraceMs ?? 1800);
    if (context.pairedAmmoNearby) {
        return {
            shouldDrop: false,
            next: { key: flareKey, firstEmptyAt: timestamp, retryAt: timestamp + graceMs },
        };
    }

    if (current.key !== flareKey) {
        return {
            shouldDrop: false,
            next: { key: flareKey, firstEmptyAt: timestamp, retryAt: timestamp + graceMs },
        };
    }
    if (timestamp < Math.max(current.retryAt, current.firstEmptyAt + graceMs)) {
        return { shouldDrop: false, next: current };
    }
    return {
        shouldDrop: true,
        // A longer retry interval allows the authoritative inventory/loot
        // update to arrive before another drop or pickup decision is made.
        next: { ...current, retryAt: timestamp + 2200 },
    };
}
