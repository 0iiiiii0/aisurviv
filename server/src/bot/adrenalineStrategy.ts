export type AdrenalinePhase = "early" | "mid" | "late" | "final";

export type AdrenalineMovementPurpose =
    | "explore"
    | "gas"
    | "combat"
    | "regroup"
    | "faction"
    | "airdrop"
    | "rescue"
    | "position"
    | "puzzle";

export interface AdrenalineDecisionContext {
    level: number;
    health: number;
    phase: AdrenalinePhase;
    enemyNearby: boolean;
    underBallisticThreat: boolean;
    outsideGas: boolean;
    underAirstrike: boolean;
    recentlyDamaged: boolean;
    actionActive: boolean;
    sodaCount: number;
    painkillerCount: number;
    distanceToObjective: number;
    factionMode: boolean;
    contestedObjective: boolean;
    timestamp: number;
    lastUseAt: number;
}

export interface AdrenalineMovementContext {
    level: number;
    phase: AdrenalinePhase;
    purpose: AdrenalineMovementPurpose;
    distanceToTarget: number;
    lowHealth: boolean;
    underBallisticThreat: boolean;
    factionMode: boolean;
    contestedObjective: boolean;
}

export interface AdrenalineMovementPlan {
    active: boolean;
    directWeight: number;
    aggressionMultiplier: number;
    retreatHealthReduction: number;
    preferMeleeForTravel: boolean;
}

export function clampAdrenaline(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, value));
}

export function desiredAdrenalineLevel(
    context: Pick<
        AdrenalineDecisionContext,
        "phase" | "distanceToObjective" | "factionMode" | "contestedObjective"
    >,
): number {
    let target = context.phase === "final" ? 95 : context.phase === "late" ? 82 : context.phase === "mid" ? 68 : 60;
    if (context.distanceToObjective >= 55) target += 6;
    if (context.factionMode && context.distanceToObjective >= 35) target += 5;
    if (context.contestedObjective) target += 7;
    return Math.max(45, Math.min(100, target));
}

export function shouldBuildAdrenaline(context: AdrenalineDecisionContext): boolean {
    const target = desiredAdrenalineLevel(context);
    if (context.level >= target) return false;
    if (context.health < 55) return false;
    if (context.enemyNearby || context.underBallisticThreat) return false;
    if (context.outsideGas || context.underAirstrike) return false;
    if (context.recentlyDamaged || context.actionActive) return false;
    if (context.sodaCount <= 0 && context.painkillerCount <= 0) return false;
    if (context.timestamp - context.lastUseAt < 1200) return false;
    return true;
}

export function chooseAdrenalineConsumable(
    context: AdrenalineDecisionContext,
): "soda" | "painkiller" | "" {
    if (!shouldBuildAdrenaline(context)) return "";

    // Soda is preferred because it is the lower-commitment boost item. Preserve
    // one soda during early/mid phases unless a long or contested rotation is pending.
    const preserveSoda = (context.phase === "early" || context.phase === "mid")
        && !context.contestedObjective
        && context.distanceToObjective < 45;
    if (context.sodaCount > (preserveSoda ? 1 : 0)) return "soda";

    // Painkillers are reserved for low boost, late/final preparation, or when
    // soda stock cannot reach the desired threshold.
    if (
        context.painkillerCount > 0
        && (context.level < 40 || context.phase === "late" || context.phase === "final" || context.contestedObjective)
    ) {
        return "painkiller";
    }
    if (context.sodaCount > 0) return "soda";
    return "";
}

export function adrenalineMovementPlan(
    context: AdrenalineMovementContext,
): AdrenalineMovementPlan {
    const level = clampAdrenaline(context.level);
    if (level < 50) {
        return {
            active: false,
            directWeight: 0,
            aggressionMultiplier: 1,
            retreatHealthReduction: 0,
            preferMeleeForTravel: false,
        };
    }

    let active = false;
    switch (context.purpose) {
        case "gas":
            active = context.distanceToTarget > 10;
            break;
        case "combat":
            active = context.distanceToTarget > 18;
            break;
        case "faction":
        case "regroup":
        case "airdrop":
            active = context.distanceToTarget > 24;
            break;
        case "explore":
            active = context.distanceToTarget > 38;
            break;
        case "rescue":
            active = context.distanceToTarget > 16;
            break;
        case "position":
            active = context.phase === "final" && context.distanceToTarget > 8;
            break;
    }

    const levelT = Math.max(0, Math.min(1, (level - 50) / 50));
    const phaseBonus = context.phase === "final" ? 0.18 : context.phase === "late" ? 0.09 : 0;
    const purposeBonus = context.purpose === "gas" || context.purpose === "airdrop"
        ? 0.12
        : context.purpose === "combat" && context.contestedObjective
        ? 0.1
        : 0;
    const directWeight = active ? Math.min(0.58, 0.16 + levelT * 0.24 + phaseBonus + purposeBonus) : 0;
    const aggressionMultiplier = context.phase === "final"
        ? 1 + levelT * 0.22
        : context.purpose === "combat"
        ? 1 + levelT * 0.1
        : 1;
    const retreatHealthReduction = context.phase === "final" ? Math.round(4 + levelT * 5) : Math.round(levelT * 3);
    const preferMeleeForTravel = active
        && !context.underBallisticThreat
        && !context.lowHealth
        && (context.purpose === "gas" || context.purpose === "explore" || context.purpose === "faction")
        && context.distanceToTarget > 32;

    return {
        active,
        directWeight,
        aggressionMultiplier,
        retreatHealthReduction,
        preferMeleeForTravel,
    };
}
