export interface DualSwitchEvaluation {
    difficulty?: string;
    currentType?: string;
    otherType?: string;
    currentCooldown: number;
    otherCooldown: number;
    otherAmmo: number;
    otherInRange: boolean;
    currentFireMode: string;
    otherFireMode: string;
    currentFireDelay: number;
    otherFireDelay: number;
    currentMaxClip: number;
    currentBulletCount?: number;
    otherBulletCount?: number;
    currentRange?: number;
    otherRange?: number;
    targetDistance?: number;
    currentDeployGroup?: number;
    otherDeployGroup?: number;
    switchDelay: number;
    currentIsLauncher?: boolean;
    otherIsLauncher?: boolean;
    shotConfirmed?: boolean;
    mobilityThreat?: boolean;
}

export interface DualSwitchDecision {
    useful: boolean;
    reason:
        | "ready"
        | "difficulty"
        | "unconfirmed-shot"
        | "ammo"
        | "range"
        | "other-cooldown"
        | "utility"
        | "fire-mode"
        | "pair"
        | "no-advance";
    estimatedAdvanceMs: number;
}

const utilityWeaponPattern = /(?:flare|strobe|bugle|spud|potato|cannon|launcher|m79|mgl|rpg|snowball)/i;

export function supportsHighLevelDualSwitch(difficulty: string): boolean {
    return difficulty === "pro" || difficulty === "legit" || difficulty === "forbidden";
}

export function isDualSwitchUtilityWeapon(type: string, isLauncher = false): boolean {
    return isLauncher || utilityWeaponPattern.test(String(type ?? ""));
}

export function isDualSwitchDestinationInRange(
    targetDistance: number,
    destinationRange: number,
    tolerance = 0.35,
): boolean {
    return (
        Number.isFinite(targetDistance)
        && targetDistance >= 0
        && targetDistance <= Math.max(0, Number(destinationRange) || 0) + Math.max(0, tolerance)
    );
}

/**
 * A confirmed-shot cycle should happen before an optional magazine top-up.
 * An already active reload remains authoritative and is never interrupted by
 * this policy.
 */
export function shouldPrioritizeDualSwitchBeforeReload(input: {
    plannedSlot: number;
    currentSlot: number;
    reloadActive: boolean;
}): boolean {
    return (
        !input.reloadActive
        && input.plannedSlot >= 0
        && input.plannedSlot !== input.currentSlot
    );
}

/**
 * A legal two-gun cycle is only armed after the authoritative ammo/cooldown
 * state confirms a shot. This allows slow bolt/pump/single-shot weapons to
 * alternate without turning ordinary weapon scoring into slot oscillation.
 */
export function evaluateDualSwitch(input: DualSwitchEvaluation): DualSwitchDecision {
    if (input.difficulty && !supportsHighLevelDualSwitch(input.difficulty)) {
        return { useful: false, reason: "difficulty", estimatedAdvanceMs: 0 };
    }
    if (!input.shotConfirmed) {
        return { useful: false, reason: "unconfirmed-shot", estimatedAdvanceMs: 0 };
    }
    if (input.otherAmmo <= 0) {
        return { useful: false, reason: "ammo", estimatedAdvanceMs: 0 };
    }
    if (!input.otherInRange) {
        return { useful: false, reason: "range", estimatedAdvanceMs: 0 };
    }
    // WeaponManager replaces the destination gun's remaining cooldown with
    // its deploy delay. Therefore a still-cycling destination gun may be the
    // correct choice when its deploy delay is shorter than the active gun's
    // post-shot recovery. Requiring otherCooldown <= 0 made two-gun cycling
    // fire twice from one slot before switching back.
    if (
        isDualSwitchUtilityWeapon(String(input.currentType ?? ""), input.currentIsLauncher)
        || isDualSwitchUtilityWeapon(String(input.otherType ?? ""), input.otherIsLauncher)
    ) {
        return { useful: false, reason: "utility", estimatedAdvanceMs: 0 };
    }
    // 当前武器必须是单发；副武器可为自动——仅当当前是慢速单发（狙击/栓动）
    // 时允许切到自动副武器补枪（经典狙击双切）；快单发（DMR）+ 自动
    // 不双切（防乱切）。
    const currentSlow = Number(input.currentFireDelay) >= 0.42
        || Number(input.currentMaxClip) <= 2;
    if (input.currentFireMode !== "single") {
        return { useful: false, reason: "fire-mode", estimatedAdvanceMs: 0 };
    }
    if (input.otherFireMode !== "single" && !currentSlow) {
        return { useful: false, reason: "fire-mode", estimatedAdvanceMs: 0 };
    }
    // 副武器合适性：狙击（慢单发）→ 自动副武器时允许更快的射速
    // （经典双切：切过去持续输出）；其他情况维持 0.16 下限防无效乱切。
    const otherSuitable = input.otherFireMode !== "single" && currentSlow
        ? Number(input.otherFireDelay) >= 0.05
        : Number(input.otherFireDelay) >= 0.16
            && Number(input.otherFireDelay) <= Math.max(1.9, Number(input.currentFireDelay) * 1.35);
    const currentDeployGroup = Number(input.currentDeployGroup ?? 0);
    const otherDeployGroup = Number(input.otherDeployGroup ?? 0);
    const explicitPair = Number.isFinite(currentDeployGroup)
        && currentDeployGroup > 0
        && currentDeployGroup === otherDeployGroup;

    // Precision rifle + pump/break-action shotgun is a deliberate high-level
    // combo: the rifle supplies the opening long-range hit and the shotgun
    // supplies the close-range follow-up while the rifle cycles. Earlier code
    // rejected this pair because the two weapons have different deploy groups
    // and the shotgun's normal switch delay is close to its pump delay.
    const currentPellets = Math.max(1, Number(input.currentBulletCount ?? 1));
    const otherPellets = Math.max(1, Number(input.otherBulletCount ?? 1));
    const currentRange = Math.max(0, Number(input.currentRange ?? 0));
    const otherRange = Math.max(0, Number(input.otherRange ?? 0));
    const currentPrecision = currentPellets === 1
        && Number(input.currentFireDelay) >= 0.65
        && (currentRange <= 0 || currentRange >= 36);
    const otherPrecision = otherPellets === 1
        && Number(input.otherFireDelay) >= 0.65
        && (otherRange <= 0 || otherRange >= 36);
    const currentShotgun = currentPellets >= 5 && Number(input.currentFireDelay) >= 0.45;
    const otherShotgun = otherPellets >= 5 && Number(input.otherFireDelay) >= 0.45;
    const precisionShotgunPair = (currentPrecision && otherShotgun)
        || (currentShotgun && otherPrecision);

    if (!explicitPair && !precisionShotgunPair && (!currentSlow || !otherSuitable)) {
        return { useful: false, reason: "pair", estimatedAdvanceMs: 0 };
    }

    // The community quick-switch window removes most of the deploy wait for a
    // precision/shotgun cycle. The committed-slot state machine still requires
    // the destination weapon to really fire before switching back.
    const effectiveSwitchDelay = precisionShotgunPair
        ? Math.min(Math.max(0, Number(input.switchDelay) || 0), 0.28)
        : Math.max(0, Number(input.switchDelay) || 0);
    const advanceSeconds = Number(input.currentCooldown) - effectiveSwitchDelay;
    if (advanceSeconds <= 0.055) {
        return {
            useful: false,
            reason: "no-advance",
            estimatedAdvanceMs: Math.round(Math.max(0, advanceSeconds) * 1000),
        };
    }

    return {
        useful: true,
        reason: "ready",
        estimatedAdvanceMs: Math.round(advanceSeconds * 1000),
    };
}

export function shouldQuickSwitch(input: DualSwitchEvaluation): boolean {
    return evaluateDualSwitch(input).useful;
}
