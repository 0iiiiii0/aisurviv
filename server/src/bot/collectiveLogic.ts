import type { Vec2 } from "../../../shared/utils/v2.ts";

export interface AirdropSupportRequest {
    activeDrop: boolean;
    assigned: boolean;
    armed: boolean;
    committedResource: boolean;
    enemyDistance: number;
    recentlyDamaged: boolean;
    nearbySupporters: number;
    timestamp: number;
    startedAt: number;
    maxSupporters?: number;
    maxDurationMs?: number;
}

export interface AirdropSupportDecision {
    defend: boolean;
    reason:
        | "active"
        | "inactive-drop"
        | "not-assigned"
        | "unarmed"
        | "resource-committed"
        | "enemy-pressure"
        | "support-cap"
        | "expired";
    startedAt: number;
}

/**
 * Gate a team-wide airdrop defence directive so it cannot consume the whole
 * faction. The directive is deliberately subordinate to acquiring a usable
 * firearm, an already committed resource, and nearby combat pressure.
 */
export function evaluateAirdropSupport(
    request: AirdropSupportRequest,
): AirdropSupportDecision {
    const maxSupporters = Math.max(1, request.maxSupporters ?? 4);
    const maxDurationMs = Math.max(1500, request.maxDurationMs ?? 12_000);

    if (!request.activeDrop) {
        return { defend: false, reason: "inactive-drop", startedAt: 0 };
    }
    if (!request.assigned) {
        return { defend: false, reason: "not-assigned", startedAt: 0 };
    }
    if (!request.armed) {
        return { defend: false, reason: "unarmed", startedAt: 0 };
    }
    if (request.committedResource) {
        return { defend: false, reason: "resource-committed", startedAt: 0 };
    }
    if (request.enemyDistance < 34 || request.recentlyDamaged) {
        return { defend: false, reason: "enemy-pressure", startedAt: 0 };
    }
    if (request.startedAt <= 0 && request.nearbySupporters >= maxSupporters) {
        return { defend: false, reason: "support-cap", startedAt: 0 };
    }
    const startedAt = request.startedAt > 0 ? request.startedAt : request.timestamp;
    if (request.timestamp - startedAt >= maxDurationMs) {
        return { defend: false, reason: "expired", startedAt: 0 };
    }
    return { defend: true, reason: "active", startedAt };
}

export interface RecoveryObjectiveRequest {
    state: string;
    pos: Vec2;
    lastCommandDirection: Vec2;
    gasWaypoint?: Vec2 | null;
    airstrikeWaypoint?: Vec2 | null;
    lootTarget?: Vec2 | null;
    crateTarget?: Vec2 | null;
    tacticalTarget?: Vec2 | null;
    flareTarget?: Vec2 | null;
    finalTarget?: Vec2 | null;
    roomDoorTarget?: Vec2 | null;
    exploreTarget?: Vec2 | null;
}

const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (value: Vec2, scalar: number): Vec2 => ({
    x: value.x * scalar,
    y: value.y * scalar,
});
const normalize = (value: Vec2): Vec2 => {
    const length = Math.hypot(value.x, value.y);
    return length > 1e-5
        ? { x: value.x / length, y: value.y / length }
        : { x: 1, y: 0 };
};

/**
 * Choose the objective used by stuck recovery. Survival states must never use
 * an old loot/crate commitment, otherwise the recovery override can steer an
 * escaping bot back into gas or an airstrike.
 */
export function selectRecoveryObjective(request: RecoveryObjectiveRequest): Vec2 {
    const fallback = add(
        request.pos,
        mul(normalize(request.lastCommandDirection), 18),
    );

    if (request.state === "gas") {
        return request.gasWaypoint ?? fallback;
    }
    if (request.state === "airstrike") {
        return request.airstrikeWaypoint ?? fallback;
    }
    if (
        request.state === "combat"
        || request.state === "counterfire"
        || request.state === "retreat"
        || request.state === "heal"
        || request.state === "revive"
    ) {
        return fallback;
    }

    return (
        request.lootTarget
            ?? request.crateTarget
            ?? request.tacticalTarget
            ?? request.flareTarget
            ?? request.finalTarget
            ?? request.roomDoorTarget
            ?? request.exploreTarget
            ?? fallback
    );
}

export interface ResourceCrowdingRequest {
    distanceToTarget: number;
    nearestFriendlyDistance: number;
    nearbyFriendlies: number;
    urgent: boolean;
    underarmed: boolean;
}

/** Cross-worker crowd gate using the authoritative nearby player positions. */
export function shouldYieldCrowdedResource(
    request: ResourceCrowdingRequest,
): boolean {
    if (request.distanceToTarget <= 2.4) return false;
    if (request.nearbyFriendlies <= 0) return false;
    if (request.underarmed && request.urgent && request.nearbyFriendlies === 1) {
        return request.nearestFriendlyDistance + 1.5 < request.distanceToTarget;
    }
    return (
        request.nearbyFriendlies >= 2
        || request.nearestFriendlyDistance + 0.75 < request.distanceToTarget
    );
}
