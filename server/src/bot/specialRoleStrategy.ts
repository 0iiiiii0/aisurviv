import type { Vec2 } from "../../../shared/utils/v2.ts";
import type { MapPhase } from "./mapStrategy.ts";

export type SpecialFactionRole =
    | "none"
    | "leader"
    | "lieutenant"
    | "medic"
    | "marksman"
    | "recon"
    | "grenadier"
    | "bugler"
    | "last_man";

export function isSelfRevivingFactionMedic(input: {
    factionMode: boolean;
    downed: boolean;
    role: string;
    actionType: number;
    reviveActionType: number;
}): boolean {
    return Boolean(
        input.factionMode
            && input.downed
            && input.role === "medic"
            && input.actionType === input.reviveActionType,
    );
}

export type FactionMedicSelfReviveDecision = "none" | "start" | "hold";

/**
 * Chooses the downed 50v50 medic's self-revive action.
 *
 * `hold` intentionally covers both an already-started self revive and a revive
 * owned by another teammate; the client should not spam a second Revive input
 * while the authoritative server has a revive action in progress.
 */
export function factionMedicSelfReviveDecision(input: {
    factionMode: boolean;
    downed: boolean;
    role: string;
    actionType: number;
    noneActionType: number;
    reviveActionType: number;
}): FactionMedicSelfReviveDecision {
    if (!input.factionMode || !input.downed || input.role !== "medic") {
        return "none";
    }
    if (input.actionType === input.reviveActionType) return "hold";
    if (input.actionType === input.noneActionType) return "start";
    return "none";
}

export interface SpecialRoleProfile {
    preferredRangeMultiplier: number;
    aggressionMultiplier: number;
    strafeMultiplier: number;
    rescuePriority: number;
    formationOffset: number;
    ammoMultiplier: number;
    healHealthkitAt: number;
    healBandageAt: number;
    boostPainkillerAt: number;
    boostSodaAt: number;
}

export interface LeaderFlareContext {
    position: Vec2;
    mapWidth: number;
    mapHeight: number;
    phase: MapPhase;
    health: number;
    enemyDistance: number;
    outsideGas: boolean;
    underAirstrike: boolean;
    /** Authoritative player indoor state. A flare may never be fired while true. */
    indoors: boolean;
    nearbyAllies: number;
    nearbyEnemies: number;
    hasFlareGun: boolean;
    flareAmmo: number;
    nearestAirdropDistance: number;
    nearestStructureDistance: number;
    safeCenter: Vec2 | null;
    safeRadius: number | null;
    formationAnchor: Vec2 | null;
    objective: Vec2 | null;
    homeAnchor: Vec2 | null;
    timestamp: number;
    lastFlareAt: number;
    /** First deployment window after the leader role is assigned. */
    openingDeployment?: boolean;
}

export interface LeaderFlareDecision {
    use: boolean;
    stagingPoint: Vec2;
    reason: string;
}

export interface BugleContext {
    health: number;
    enemyDistance: number;
    nearbyAllies: number;
    nearbyEnemies: number;
    alliesUnderFire: number;
    /** Nearby allies who are currently inside an airstrike danger zone. */
    alliesUnderAirstrike: number;
    stance: string;
    phase: MapPhase;
    hasBugle: boolean;
    bugleAmmo: number;
    timestamp: number;
    lastBugleAt: number;
}

export interface GrenadeContext {
    enemyDistance: number;
    enemyCluster: number;
    friendlyCluster: number;
    hasMirv: boolean;
    hasFrag: boolean;
    underFire: boolean;
    phase: MapPhase;
    timestamp: number;
    lastThrowAt: number;
}

export interface GrenadeDecision {
    use: boolean;
    type: "mirv" | "frag" | "";
    reason: string;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Vec2, scalar: number): Vec2 => ({ x: a.x * scalar, y: a.y * scalar });
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const length = (value: Vec2): number => Math.hypot(value.x, value.y);
const normalize = (value: Vec2, fallback: Vec2 = { x: 1, y: 0 }): Vec2 => {
    const len = length(value);
    return len > 0.0001 ? { x: value.x / len, y: value.y / len } : fallback;
};
const distance = (a: Vec2, b: Vec2): number => length(sub(a, b));
const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
});

const PROFILES: Record<SpecialFactionRole, SpecialRoleProfile> = {
    none: {
        preferredRangeMultiplier: 1,
        aggressionMultiplier: 1,
        strafeMultiplier: 1,
        rescuePriority: 1,
        formationOffset: 0,
        ammoMultiplier: 1,
        healHealthkitAt: 42,
        healBandageAt: 76,
        boostPainkillerAt: 35,
        boostSodaAt: 70,
    },
    leader: {
        preferredRangeMultiplier: 1.05,
        aggressionMultiplier: 0.92,
        strafeMultiplier: 0.92,
        rescuePriority: 0.72,
        formationOffset: -4,
        ammoMultiplier: 1.12,
        healHealthkitAt: 52,
        healBandageAt: 82,
        boostPainkillerAt: 48,
        boostSodaAt: 78,
    },
    lieutenant: {
        preferredRangeMultiplier: 1.02,
        aggressionMultiplier: 1.12,
        strafeMultiplier: 0.95,
        rescuePriority: 0.8,
        formationOffset: 0,
        ammoMultiplier: 1.45,
        healHealthkitAt: 40,
        healBandageAt: 70,
        boostPainkillerAt: 32,
        boostSodaAt: 66,
    },
    medic: {
        preferredRangeMultiplier: 1.22,
        aggressionMultiplier: 0.72,
        strafeMultiplier: 0.9,
        rescuePriority: 1.9,
        formationOffset: -8,
        ammoMultiplier: 0.78,
        healHealthkitAt: 60,
        healBandageAt: 84,
        boostPainkillerAt: 56,
        boostSodaAt: 84,
    },
    marksman: {
        preferredRangeMultiplier: 1.42,
        aggressionMultiplier: 0.88,
        strafeMultiplier: 0.78,
        rescuePriority: 0.72,
        formationOffset: -6,
        ammoMultiplier: 1.22,
        healHealthkitAt: 44,
        healBandageAt: 74,
        boostPainkillerAt: 42,
        boostSodaAt: 74,
    },
    recon: {
        preferredRangeMultiplier: 0.76,
        aggressionMultiplier: 1.18,
        strafeMultiplier: 1.34,
        rescuePriority: 0.88,
        formationOffset: 8,
        ammoMultiplier: 1.08,
        healHealthkitAt: 38,
        healBandageAt: 68,
        boostPainkillerAt: 44,
        boostSodaAt: 78,
    },
    grenadier: {
        preferredRangeMultiplier: 0.9,
        aggressionMultiplier: 1.04,
        strafeMultiplier: 0.88,
        rescuePriority: 0.78,
        formationOffset: -1,
        ammoMultiplier: 1.05,
        healHealthkitAt: 44,
        healBandageAt: 74,
        boostPainkillerAt: 36,
        boostSodaAt: 70,
    },
    bugler: {
        preferredRangeMultiplier: 1.16,
        aggressionMultiplier: 0.8,
        strafeMultiplier: 0.9,
        rescuePriority: 1.15,
        formationOffset: -7,
        ammoMultiplier: 0.9,
        healHealthkitAt: 52,
        healBandageAt: 80,
        boostPainkillerAt: 50,
        boostSodaAt: 82,
    },
    last_man: {
        preferredRangeMultiplier: 1.04,
        aggressionMultiplier: 1.32,
        strafeMultiplier: 1.15,
        rescuePriority: 0,
        formationOffset: 0,
        ammoMultiplier: 1.65,
        healHealthkitAt: 58,
        healBandageAt: 82,
        boostPainkillerAt: 65,
        boostSodaAt: 90,
    },
};

export const normalizeSpecialFactionRole = (value: string): SpecialFactionRole => {
    const normalized = value.trim().toLowerCase().replace(/[-\s]+/g, "_");
    if (normalized === "captain" || normalized === "commander") return "leader";
    if (normalized === "lt") return "lieutenant";
    if (normalized === "sniper") return "marksman";
    if (normalized === "scout") return "recon";
    if (normalized === "demo") return "grenadier";
    if (normalized === "lone_survivor" || normalized === "lastman") return "last_man";
    return normalized in PROFILES ? (normalized as SpecialFactionRole) : "none";
};

export const specialRoleProfile = (role: SpecialFactionRole): SpecialRoleProfile => PROFILES[role] ?? PROFILES.none;

export const specialRoleTargetModifier = (
    selfRole: SpecialFactionRole,
    enemyRoleValue: string,
    distanceToEnemy: number,
    enemyDowned: boolean,
): number => {
    const enemyRole = normalizeSpecialFactionRole(enemyRoleValue);
    if (enemyDowned) return selfRole === "last_man" ? 10 : -10;

    let value = 0;
    if (enemyRole === "leader") value += selfRole === "marksman" ? 75 : 40;
    if (enemyRole === "medic") value += selfRole === "marksman" ? 60 : 32;
    if (enemyRole === "bugler") value += selfRole === "marksman" ? 48 : 22;
    if (enemyRole === "grenadier" && distanceToEnemy < 26) value += 26;
    if (enemyRole === "last_man") value += 50;

    if (selfRole === "marksman" && enemyRole !== "none") value += 30;
    if (selfRole === "last_man") value += 55;
    if (selfRole === "recon" && distanceToEnemy <= 28) value += 15;
    if (selfRole === "medic" && distanceToEnemy < 18) value += 22;
    return value;
};

/**
 * Multiplier for rescue willingness. Medics can accept a controlled amount of
 * pressure when an ally provides cover; other roles remain conservative.
 */
export const specialRoleRescueMultiplier = (
    role: SpecialFactionRole,
    enemiesNear: number,
    alliesNear: number,
    targetOutsideGas: boolean,
    selfHealth: number,
): number => {
    if (role === "last_man") return 0;
    let value = specialRoleProfile(role).rescuePriority;
    if (role === "medic") {
        if (enemiesNear <= 1 && alliesNear >= 1) value *= 1.35;
        if (enemiesNear >= 2) value *= 0.42;
        if (selfHealth < 28) value *= 0.35;
    } else {
        if (enemiesNear > 0) value *= 0.35;
        if (alliesNear <= 0) value *= 0.7;
        if (selfHealth < 55) value *= 0.55;
    }
    if (targetOutsideGas) value *= role === "medic" ? 0.62 : 0.28;
    return clamp(value, 0, 2.5);
};

export const specialRoleWeaponModifier = (
    role: SpecialFactionRole,
    weaponType: string,
    defType: string,
    weaponRange: number,
    distanceToEnemy: number,
): number => {
    const type = weaponType.toLowerCase();
    if (defType === "melee") {
        if (role === "recon" && distanceToEnemy <= 5) return 20;
        if (role === "medic" && /bonesaw/.test(type) && distanceToEnemy <= 5) return 26;
        return 0;
    }
    if (defType !== "gun") return 0;

    let value = 0;
    switch (role) {
        case "leader":
            if (/m1014|an94/.test(type)) value += 38;
            if (type === "flare_gun") value -= 1000;
            if (weaponRange >= 55) value += 12;
            break;
        case "lieutenant":
            if (/m4a1|grozas|hk416|ak47|scar|famas|an94/.test(type)) value += 44;
            if (/m249|pkp|dp28|qbb|l86/.test(type)) value += 22;
            if (distanceToEnemy <= 60) value += 16;
            break;
        case "medic":
            if (/mp5|ump|mac10|vector|glock|m9|m93r/.test(type)) value += 26;
            if (weaponRange > 85) value -= 16;
            break;
        case "marksman":
            if (/l86|svd|scarssr|mk12|mosin|sv98|scout|m39|vss/.test(type)) value += 62;
            if (weaponRange >= 75) value += 30;
            if (distanceToEnemy < 14 && weaponRange >= 85) value -= 32;
            break;
        case "recon":
            if (/glock_dual|glock|m93r|vector|mac10|mp5|ump/.test(type)) value += 54;
            if (weaponRange <= 58) value += 22;
            if (/m249|pkp|dp28|qbb/.test(type)) value -= 24;
            break;
        case "grenadier":
            if (/mp220|m870|m1100|saiga|spas/.test(type)) value += 40;
            if (distanceToEnemy <= 22) value += 14;
            break;
        case "bugler":
            if (type === "bugle") value -= 1000;
            if (weaponRange >= 45 && weaponRange <= 78) value += 18;
            break;
        case "last_man":
            if (/m249|pkp|dp28|qbb|l86/.test(type)) value += 88;
            if (weaponRange >= 55) value += 22;
            break;
        default:
            break;
    }
    return value;
};

export const specialRoleLootModifier = (
    role: SpecialFactionRole,
    itemType: string,
    defType: string,
    currentCount: number,
    health: number,
): number => {
    const type = itemType.toLowerCase();
    let value = 0;
    switch (role) {
        case "leader":
            if (type === "flare" || type === "flare_gun") value += 180;
            if (defType === "scope" && /8x|15x/.test(type)) value += 22;
            if (defType === "heal" || defType === "boost") value += 12;
            break;
        case "lieutenant":
            if (defType === "ammo") value += currentCount < 150 ? 38 : 8;
            if (defType === "gun" && /m4a1|grozas|hk416|ak47|scar|famas/.test(type)) value += 48;
            break;
        case "medic":
            if (type === "healthkit") value += currentCount < 6 ? 92 : 20;
            if (type === "soda" || type === "painkiller") value += currentCount < 12 ? 66 : 14;
            if (type === "smoke") value += currentCount < 8 ? 88 : 10;
            if (defType === "ammo") value -= 8;
            break;
        case "marksman":
            if (defType === "scope" && /4x|8x|15x/.test(type)) value += 72;
            if (defType === "gun" && /l86|svd|scarssr|mk12|mosin|sv98|scout|m39|vss/.test(type)) value += 82;
            break;
        case "recon":
            if (defType === "boost") value += 34;
            if (defType === "gun" && /glock|vector|mac10|mp5|ump|m93r/.test(type)) value += 68;
            if (defType === "scope" && /8x|15x/.test(type)) value -= 25;
            break;
        case "grenadier":
            if (type === "mirv") value += currentCount < 10 ? 110 : 18;
            if (type === "frag") value += currentCount < 14 ? 76 : 10;
            if (defType === "gun" && /mp220|m870|saiga|spas/.test(type)) value += 44;
            break;
        case "bugler":
            if (defType === "heal" || defType === "boost" || type === "smoke") value += 32;
            if (defType === "gun" && type !== "bugle") value += 20;
            break;
        case "last_man":
            if (defType === "ammo") value += 68;
            if (type === "mirv") value += 84;
            if (defType === "heal" || defType === "boost") value += health < 85 ? 54 : 22;
            if (defType === "gun" && /m249|pkp|dp28|qbb|l86/.test(type)) value += 96;
            break;
        default:
            break;
    }
    return value;
};

export const planLeaderFlare = (context: LeaderFlareContext): LeaderFlareDecision => {
    const fallback = { x: context.position.x, y: context.position.y };
    const openingDeployment = Boolean(context.openingDeployment);
    const armed = context.hasFlareGun && context.flareAmmo > 0;
    if (!armed && !openingDeployment) {
        return { use: false, stagingPoint: fallback, reason: "no flare gun or flare" };
    }
    if (!openingDeployment && context.timestamp - context.lastFlareAt < 120000) {
        return { use: false, stagingPoint: fallback, reason: "flare cooldown" };
    }
    if (context.outsideGas || context.underAirstrike) {
        return { use: false, stagingPoint: fallback, reason: "unsafe zone" };
    }
    const minimumHealth = openingDeployment ? 34 : 62;
    const minimumEnemyDistance = 14;
    if (
        context.health < minimumHealth
        || context.enemyDistance < minimumEnemyDistance
    ) {
        return { use: false, stagingPoint: fallback, reason: "combat too close" };
    }
    if (context.nearestAirdropDistance < (openingDeployment ? 26 : 42)) {
        return { use: false, stagingPoint: fallback, reason: "airdrop already nearby" };
    }

    const mapCenter = {
        x: context.mapWidth * 0.5,
        y: context.mapHeight * 0.5,
    };
    const safeCenter = context.safeCenter ?? mapCenter;
    const anchor = context.formationAnchor ?? context.homeAnchor ?? context.position;
    const objective = context.objective ?? safeCenter;
    const fallbackRear = normalize(sub(anchor, objective), normalize(sub(context.position, mapCenter)));
    const home = context.homeAnchor;
    const friendlyDirection = home
        ? normalize(sub(home, mapCenter), fallbackRear)
        : fallbackRear;
    const safeRadius = context.safeRadius === null
        ? Math.min(context.mapWidth, context.mapHeight) * 0.42
        : Math.max(0, context.safeRadius);
    const safeMargin = 12;
    const usableSafeRadius = safeRadius - safeMargin;
    if (usableSafeRadius <= 4) {
        return {
            use: false,
            stagingPoint: fallback,
            reason: "no safe rear deployment area",
        };
    }
    const homeDistance = home ? distance(home, mapCenter) : safeRadius * 0.55;
    const rearOffset = openingDeployment
        ? 9
        : context.phase === "early"
        ? 14
        : context.phase === "mid"
        ? 11
        : 8;

    // A commander flare is a rear-line team asset, not a frontline objective.
    // Start from the learned faction spawn anchor and only blend in formation
    // information after the point has been kept on the friendly half of the map.
    const homeWeight = openingDeployment
        ? 0.68
        : context.phase === "early"
        ? 0.58
        : context.phase === "mid"
        ? 0.48
        : context.phase === "late"
        ? 0.34
        : 0.2;
    const friendlyAnchor = home
        ? lerp(mapCenter, home, homeWeight)
        : add(anchor, mul(friendlyDirection, rearOffset));
    const tacticalRear = add(anchor, mul(friendlyDirection, rearOffset));
    let target = home ? lerp(friendlyAnchor, tacticalRear, 0.28) : tacticalRear;

    // Clamp the staging point to the friendly side. The late/final circle may
    // eventually force the team toward the centre, but an opening military
    // airdrop should never be deliberately called across the midline.
    const minimumFriendlyDepth = openingDeployment
        ? Math.max(10, Math.min(safeRadius * 0.34, homeDistance * 0.46))
        : context.phase === "early"
        ? Math.max(8, Math.min(safeRadius * 0.26, homeDistance * 0.34))
        : context.phase === "mid"
        ? Math.max(5, Math.min(safeRadius * 0.18, homeDistance * 0.24))
        : 1.5;
    const currentFriendlyDepth = dot(sub(target, mapCenter), friendlyDirection);
    if (currentFriendlyDepth < minimumFriendlyDepth) {
        target = add(target, mul(friendlyDirection, minimumFriendlyDepth - currentFriendlyDepth));
    }

    // Keep the point in the current safe circle without discarding faction-side
    // preference. Only late phases receive a strong pull toward the safe centre.
    const safePull = context.phase === "final" ? 0.5 : context.phase === "late" ? 0.34 : 0.12;
    target = lerp(target, safeCenter, safePull);
    if (distance(target, safeCenter) > usableSafeRadius * 0.72) {
        target = lerp(target, safeCenter, 0.46);
    }

    // Represent the final point in friendly-rear/side coordinates and constrain
    // it to the intersection of the safe circle and our half. This is a hard
    // constraint: when that intersection does not contain a useful rear-line
    // point, the leader waits instead of calling the drop into gas or enemy land.
    const safeCenterDepth = dot(sub(safeCenter, mapCenter), friendlyDirection);
    const maximumSafeDepth = safeCenterDepth + usableSafeRadius;
    const minimumOperationalDepth = openingDeployment
        ? Math.max(6, Math.min(12, minimumFriendlyDepth))
        : context.phase === "early" || context.phase === "mid"
        ? Math.max(4, Math.min(9, minimumFriendlyDepth))
        : 2;
    if (maximumSafeDepth < minimumOperationalDepth) {
        return {
            use: false,
            stagingPoint: fallback,
            reason: "safe circle is outside friendly rear",
        };
    }
    const finalFriendlyFloor = Math.max(
        minimumOperationalDepth,
        Math.min(minimumFriendlyDepth, maximumSafeDepth - 0.5),
    );
    const sideDirection = { x: -friendlyDirection.y, y: friendlyDirection.x };
    const relativeToSafeCenter = sub(target, safeCenter);
    const minimumRearCoordinate = finalFriendlyFloor - safeCenterDepth;
    const rearCoordinate = clamp(
        dot(relativeToSafeCenter, friendlyDirection),
        minimumRearCoordinate,
        usableSafeRadius,
    );
    const maximumSideCoordinate = Math.sqrt(
        Math.max(0, usableSafeRadius * usableSafeRadius - rearCoordinate * rearCoordinate),
    );
    const sideCoordinate = clamp(
        dot(relativeToSafeCenter, sideDirection),
        -maximumSideCoordinate,
        maximumSideCoordinate,
    );
    target = add(
        safeCenter,
        add(
            mul(friendlyDirection, rearCoordinate),
            mul(sideDirection, sideCoordinate),
        ),
    );

    const margin = 18;
    target = {
        x: clamp(target.x, margin, context.mapWidth - margin),
        y: clamp(target.y, margin, context.mapHeight - margin),
    };
    if (
        distance(target, safeCenter) > usableSafeRadius + 0.5
        || dot(sub(target, mapCenter), friendlyDirection) < finalFriendlyFloor - 0.5
    ) {
        return {
            use: false,
            stagingPoint: fallback,
            reason: "no map-valid friendly rear deployment point",
        };
    }

    // An indoor leader still receives an outdoor staging plan, but the caller
    // must route through a usable door and confirm the authoritative indoor flag
    // has cleared before sending Shoot. Move farther toward the friendly rear if
    // the first point is still crowded by a structure.
    if ((context.indoors || context.nearestStructureDistance < 7) && distance(context.position, target) < 4) {
        target = add(target, mul(friendlyDirection, 10));
    }
    return {
        use: armed,
        stagingPoint: target,
        reason: openingDeployment
            ? armed
                ? "leader opening deployment airdrop"
                : "opening staging while searching for flare"
            : "escorted rear-line military airdrop",
    };
};

export const shouldSoundBugle = (context: BugleContext): boolean => {
    if (!context.hasBugle || context.bugleAmmo <= 0) return false;
    if (context.timestamp - context.lastBugleAt < 150000) return false;
    if (context.health < 48 || context.enemyDistance < 7 || context.enemyDistance > 62) return false;
    if (context.nearbyAllies < 5) return false;

    const attackWindow = (context.stance === "attack" || context.stance === "defend")
        && context.nearbyEnemies >= 2
        && context.nearbyAllies >= context.nearbyEnemies;
    const emergencyWindow = context.alliesUnderFire >= 4
        && context.nearbyAllies >= 7
        && (context.phase === "late" || context.phase === "final");
    // Inspiration is primarily a movement buff. Sounding the bugle while several
    // nearby allies are caught in an airstrike gives the formation a coordinated
    // escape window instead of saving it only for an offensive push.
    const airstrikeEscapeWindow = context.alliesUnderAirstrike >= 3 && context.nearbyAllies >= 4;
    return attackWindow || emergencyWindow || airstrikeEscapeWindow;
};

export const chooseGrenade = (context: GrenadeContext): GrenadeDecision => {
    if (context.timestamp - context.lastThrowAt < 8500) {
        return { use: false, type: "", reason: "throw cooldown" };
    }
    if (context.enemyDistance < 7 || context.enemyDistance > 18) {
        return { use: false, type: "", reason: "outside throwable range" };
    }
    if (context.friendlyCluster > 0) {
        return { use: false, type: "", reason: "friendly danger radius" };
    }
    const threshold = context.phase === "late" || context.phase === "final" ? 2 : 3;
    if (context.enemyCluster < threshold && !context.underFire) {
        return { use: false, type: "", reason: "insufficient cluster" };
    }
    if (context.hasMirv && context.enemyCluster >= 3) {
        return { use: true, type: "mirv", reason: "dense enemy cluster" };
    }
    if (context.hasFrag) {
        return { use: true, type: "frag", reason: "enemy cluster" };
    }
    return { use: false, type: "", reason: "no throwable" };
};
