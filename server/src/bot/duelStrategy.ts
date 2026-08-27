import type { Vec2 } from "../../../shared/utils/v2.ts";

export type DuelPhase = "early" | "mid" | "late" | "final";
export type DuelModeSetting = "auto" | "force" | "off";
export type DuelAdrenalinePolicy = "inherit" | "build" | "prohibited";

export interface DuelDetectionContext {
    setting: DuelModeSetting;
    mapName: string;
    mapWidth: number;
    mapHeight: number;
    aliveCount: number;
    sandbagCount: number;
    arenaBreakableCount: number;
    groundLootCount: number;
    factionMode: boolean;
}

export interface DuelBehaviorProfile {
    aggressionMultiplier: number;
    retreatHealth: number;
    coverPreference: number;
    destructibleCoverBias: number;
    directMovementWeight: number;
    strafeWeight: number;
    desiredRangeMultiplier: number;
}

export interface DuelMovementContext {
    myPos: Vec2;
    targetPos: Vec2;
    baseDirection: Vec2;
    phase: DuelPhase;
    distanceToTarget: number;
    underFire: boolean;
    inCombat: boolean;
    boostLevel: number;
    adrenalinePolicy: DuelAdrenalinePolicy;
    strafeSign: number;
}

export interface DuelSandbagScoreContext {
    myPos: Vec2;
    enemyPos: Vec2;
    coverPos: Vec2;
    sandbagPos: Vec2;
    insideGas: boolean;
    lineBlocked: boolean;
    underFire: boolean;
    adrenalinePolicy: DuelAdrenalinePolicy;
    phase: DuelPhase;
}

export interface DuelBreakableScoreContext {
    healthT: number;
    distanceFromBot: number;
    distanceFromEnemy: number;
    blocksEnemy: boolean;
    material: "wood" | "stone" | "other";
    phase: DuelPhase;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Vec2, scalar: number): Vec2 => ({ x: a.x * scalar, y: a.y * scalar });
const length = (value: Vec2): number => Math.hypot(value.x, value.y);
const distance = (a: Vec2, b: Vec2): number => length(sub(a, b));
const normalize = (value: Vec2, fallback: Vec2 = { x: 1, y: 0 }): Vec2 => {
    const len = length(value);
    return len > 0.0001 ? { x: value.x / len, y: value.y / len } : fallback;
};
const perpendicular = (value: Vec2): Vec2 => ({ x: -value.y, y: value.x });

export function normalizeDuelModeSetting(value: string | undefined): DuelModeSetting {
    const normalized = String(value ?? "auto").trim().toLowerCase();
    if (normalized === "force" || normalized === "on" || normalized === "1" || normalized === "true") {
        return "force";
    }
    if (normalized === "off" || normalized === "0" || normalized === "false") return "off";
    return "auto";
}

export function normalizeDuelAdrenalinePolicy(
    value: string | undefined,
    prohibitedFlag = false,
): DuelAdrenalinePolicy {
    if (prohibitedFlag) return "prohibited";
    const normalized = String(value ?? "inherit").trim().toLowerCase();
    if (normalized === "prohibited" || normalized === "forbidden" || normalized === "off") {
        return "prohibited";
    }
    if (normalized === "build" || normalized === "consume" || normalized === "auto") return "build";
    return "inherit";
}

/**
 * Explicit configuration is authoritative. Auto detection deliberately requires
 * several arena signals so ordinary custom maps containing one sandbag are not
 * misclassified as a duel.
 */
export function detectDuelMode(context: DuelDetectionContext): boolean {
    if (context.setting === "off") return false;
    if (context.setting === "force") return true;
    if (context.factionMode) return false;

    const mapName = context.mapName.trim().toLowerCase();
    const explicitName = /(?:^|[_\-\s])(?:1v1|duel|arena)(?:$|[_\-\s])/.test(mapName)
        || /custom[_\-\s]?(?:1v1|duel)/.test(mapName);
    if (explicitName) return true;

    const compactArena = Math.max(context.mapWidth, context.mapHeight) <= 720;
    const exactlyDuelPopulation = context.aliveCount > 0 && context.aliveCount <= 2;
    const arenaGeometry = context.sandbagCount >= 2 && context.arenaBreakableCount >= 1;
    const noWorldLoot = context.groundLootCount <= 2;
    return compactArena && exactlyDuelPopulation && arenaGeometry && noWorldLoot;
}

export function duelBehaviorProfile(
    adrenalinePolicy: DuelAdrenalinePolicy,
    boostLevel: number,
): DuelBehaviorProfile {
    const effectiveBoost = adrenalinePolicy === "prohibited" ? 0 : clamp(boostLevel, 0, 100);
    const boosted = effectiveBoost >= 50;
    if (adrenalinePolicy === "prohibited") {
        return {
            aggressionMultiplier: 1.05,
            retreatHealth: 42,
            coverPreference: 1.72,
            destructibleCoverBias: 1.82,
            directMovementWeight: 0.56,
            strafeWeight: 0.64,
            desiredRangeMultiplier: 1.08,
        };
    }
    return {
        aggressionMultiplier: boosted ? 1.3 : 1.17,
        retreatHealth: boosted ? 34 : 38,
        coverPreference: boosted ? 1.48 : 1.6,
        destructibleCoverBias: 1.78,
        directMovementWeight: boosted ? 0.8 : 0.68,
        strafeWeight: boosted ? 0.4 : 0.52,
        desiredRangeMultiplier: boosted ? 0.94 : 1.02,
    };
}

/**
 * Movement input is digital. This changes route commitment and strafing only;
 * the authoritative server applies any actual boost movement multiplier.
 */
export function duelMovementDirection(context: DuelMovementContext): Vec2 {
    const direct = normalize(sub(context.targetPos, context.myPos));
    const base = normalize(context.baseDirection, direct);
    const lateral = mul(perpendicular(direct), context.strafeSign >= 0 ? 1 : -1);
    const profile = duelBehaviorProfile(context.adrenalinePolicy, context.boostLevel);
    const hasMovementBoost = context.adrenalinePolicy !== "prohibited" && context.boostLevel >= 50;

    let directWeight = profile.directMovementWeight;
    let strafeWeight = profile.strafeWeight;
    let baseWeight = 0.3;

    if (hasMovementBoost) {
        directWeight += context.inCombat ? 0.12 : 0.2;
        strafeWeight -= 0.07;
    }
    if (context.phase === "final") {
        directWeight += context.inCombat ? 0.06 : 0.02;
        strafeWeight += context.adrenalinePolicy === "prohibited" ? 0.14 : 0.05;
    }
    if (context.underFire) {
        directWeight -= 0.18;
        strafeWeight += 0.3;
        baseWeight += 0.08;
    }
    if (context.distanceToTarget < 11) {
        directWeight -= 0.2;
        strafeWeight += 0.24;
    } else if (context.distanceToTarget > 38) {
        directWeight += 0.12;
        strafeWeight -= 0.05;
    }

    return normalize(
        add(
            add(mul(base, clamp(baseWeight, 0.12, 0.5)), mul(direct, clamp(directWeight, 0.25, 1.25))),
            mul(lateral, clamp(strafeWeight, 0.08, 0.95)),
        ),
        direct,
    );
}

export function isDuelSandbagType(value: string): boolean {
    return /(?:sand[_\-\s]?bag|sandbag)/i.test(value);
}

export function duelBreakableMaterial(value: string): "wood" | "stone" | "other" | null {
    const type = value.toLowerCase();
    if (/sand[_\-\s]?bag/.test(type)) return null;
    if (/(?:wood|wooden|crate|box|case)/.test(type)) return "wood";
    if (/(?:stone|rock|boulder)/.test(type)) return "stone";
    return null;
}

/** Returns a point on the protected side of a sandbag, away from the enemy. */
export function sandbagCoverPoint(
    sandbagPos: Vec2,
    enemyPos: Vec2,
    sandbagRadius: number,
): Vec2 {
    const awayFromEnemy = normalize(sub(sandbagPos, enemyPos));
    return add(sandbagPos, mul(awayFromEnemy, Math.max(1.2, sandbagRadius + 1.05)));
}

export function scoreSandbagCover(context: DuelSandbagScoreContext): number {
    const distanceToCover = distance(context.myPos, context.coverPos);
    const enemyToSandbag = distance(context.enemyPos, context.sandbagPos);
    const playerToEnemy = distance(context.myPos, context.enemyPos);
    const gasPenalty = context.insideGas ? 0 : 190;
    const blockingBonus = context.lineBlocked ? 58 : -30;
    const distanceFit = 28 - Math.abs(clamp(enemyToSandbag, 4, 34) - 14) * 1.15;
    const conservativeBonus = context.adrenalinePolicy === "prohibited" ? 20 : 8;
    const underFireBonus = context.underFire ? 18 : 0;
    const finalBonus = context.phase === "final" ? 15 : 0;
    const tooCloseToEnemy = enemyToSandbag < 5 ? 48 : 0;
    const retreatValue = playerToEnemy < 18 ? 14 : 0;

    return 132 - distanceToCover * 1.25 + blockingBonus + distanceFit
        + conservativeBonus + underFireBonus + finalBonus + retreatValue - tooCloseToEnemy - gasPenalty;
}

export function scoreDuelBreakable(context: DuelBreakableScoreContext): number {
    if (!context.blocksEnemy) return -Infinity;
    const weakened = (1 - clamp(context.healthT, 0, 1)) * 46;
    const materialBonus = context.material === "wood" ? 20 : context.material === "stone" ? 8 : 0;
    const enemyProximity = clamp(22 - context.distanceFromEnemy, -12, 22);
    const phaseBonus = context.phase === "late" ? 6 : context.phase === "final" ? 14 : 0;
    return 96 + weakened + materialBonus + enemyProximity + phaseBonus - context.distanceFromBot * 0.72;
}

/**
 * The built-in duel arena exposes deterministic mirrored spawns. For custom
 * compact arenas, mirroring across the vertical centre remains a useful and
 * fair opening search assumption without reading an unseen player's position.
 */
export function inferDuelOpponentSpawn(
    myPos: Vec2,
    mapWidth: number,
    mapHeight: number,
): Vec2 {
    const width = Math.max(1, mapWidth);
    const height = Math.max(1, mapHeight);
    const builtInLeft = { x: width * 0.2, y: height * 0.5 };
    const builtInRight = { x: width * 0.8, y: height * 0.5 };
    const nearestBuiltIn = distance(myPos, builtInLeft) <= distance(myPos, builtInRight)
        ? builtInLeft
        : builtInRight;
    const opponentBuiltIn = nearestBuiltIn === builtInLeft ? builtInRight : builtInLeft;
    const closeToBuiltInSpawn = distance(myPos, nearestBuiltIn) <= Math.max(8, width * 0.09);
    if (closeToBuiltInSpawn) return opponentBuiltIn;
    return {
        x: clamp(width - myPos.x, 4, width - 4),
        y: clamp(myPos.y, 4, height - 4),
    };
}

export interface DuelFlankPointContext {
    myPos: Vec2;
    targetPos: Vec2;
    obstaclePos: Vec2;
    obstacleRadius: number;
    mapWidth: number;
    mapHeight: number;
    flankSign: number;
}

/**
 * Produces a committed point beyond one end of a blocking sandbag. It removes
 * the left/right input oscillation caused by recomputing a generic strafe every
 * think tick while the opponent is occluded.
 */
export function duelFlankPoint(context: DuelFlankPointContext): Vec2 {
    const approach = normalize(sub(context.targetPos, context.myPos));
    const lateral = mul(perpendicular(approach), context.flankSign >= 0 ? 1 : -1);
    const clearance = Math.max(3.1, context.obstacleRadius + 2.45);
    const forward = Math.max(1.2, context.obstacleRadius * 0.55);
    const candidate = add(
        add(context.obstaclePos, mul(lateral, clearance)),
        mul(approach, forward),
    );
    return {
        x: clamp(candidate.x, 3, Math.max(3, context.mapWidth - 3)),
        y: clamp(candidate.y, 3, Math.max(3, context.mapHeight - 3)),
    };
}

/** Stable pursuit has minimal strafing until actual line of sight is restored. */
export function duelSearchDirection(
    myPos: Vec2,
    targetPos: Vec2,
    underFire: boolean,
    flankSign: number,
): Vec2 {
    const direct = normalize(sub(targetPos, myPos));
    if (!underFire) return direct;
    return normalize(add(mul(direct, 0.78), mul(perpendicular(direct), flankSign >= 0 ? 0.22 : -0.22)));
}
