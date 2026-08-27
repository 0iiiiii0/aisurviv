import type { StairFireRegion } from "./crossFloorFireSafety.ts";

export interface StairNavigationPoint {
    x: number;
    y: number;
}

export interface StairTraversalInput {
    position: StairNavigationPoint;
    currentLayer: number;
    target: StairNavigationPoint;
    targetLayer: number;
    stairs: readonly StairFireRegion[];
    preferredConnector?: {
        structureId: number;
        stairIndex: number;
    } | null;
    playerRadius?: number;
}

export interface StairTraversalPlan {
    point: StairNavigationPoint;
    entry: StairNavigationPoint;
    exit: StairNavigationPoint;
    structureId: number;
    stairIndex: number;
    phase: "approach" | "cross";
}

const distance = (a: StairNavigationPoint, b: StairNavigationPoint): number => Math.hypot(a.x - b.x, a.y - b.y);

const normalized = (value: StairNavigationPoint): StairNavigationPoint => {
    const len = Math.hypot(value.x, value.y);
    return len > 0.0001 ? { x: value.x / len, y: value.y / len } : { x: 0, y: 1 };
};

export const baseFloorLayer = (layer: number): number => Number(layer) & 0x1;

export const isStairLayer = (layer: number): boolean => (Number(layer) & 0x2) !== 0;

export const STAIR_TRAVERSAL_TIMEOUT_MS = 12_000;
export const STAIR_CROSSING_FINISH_GRACE_MS = 4_000;

/** Preserve the first absolute deadline instead of sliding it every tick. */
export function stairLockDeadline(
    existingExpiresAt: number | undefined,
    timestamp: number,
): number {
    return existingExpiresAt !== undefined && Number.isFinite(existingExpiresAt)
        ? existingExpiresAt
        : timestamp + STAIR_TRAVERSAL_TIMEOUT_MS;
}

/** A bot already inside a connector gets a short bounded window to exit it. */
export function shouldFinishLockedStairCrossing(
    currentLayer: number,
    expiresAt: number,
    timestamp: number,
): boolean {
    return (
        isStairLayer(currentLayer)
        && timestamp <= expiresAt + STAIR_CROSSING_FINISH_GRACE_MS
    );
}

export function botLayersInteract(a: number, b: number): boolean {
    return Boolean((a & 0x1) === (b & 0x1) || (a & 0x2 && b & 0x2));
}

/**
 * Chooses a real stair connector for a base-floor transition. `downDir` points
 * from the ground side toward the bunker side, matching Structure.checkStairs.
 * Once the player enters the AABB, the waypoint moves beyond the opposite end
 * so a transient layer 2/3 update cannot reverse the route halfway through.
 */
export function chooseStairTraversal(
    input: StairTraversalInput,
): StairTraversalPlan | null {
    const currentBase = baseFloorLayer(input.currentLayer);
    const targetBase = baseFloorLayer(input.targetLayer);
    // Structure.checkStairs changes the base bit before the player has left the
    // stair AABB (2 -> 3 while descending, 3 -> 2 while ascending). Keep the
    // crossing command alive through that target-side intermediate layer;
    // otherwise the bot stops in the middle of the connector.
    if (
        (currentBase === targetBase && !isStairLayer(input.currentLayer))
        || input.stairs.length === 0
    ) {
        return null;
    }

    const padding = Math.max(0.55, Number(input.playerRadius) || 0.72) + 0.7;
    let best: StairTraversalPlan | null = null;
    let bestScore = Infinity;

    const preferred = input.preferredConnector
        ? input.stairs.filter(
            (stair) =>
                stair.structureId === input.preferredConnector?.structureId
                && stair.stairIndex === input.preferredConnector?.stairIndex,
        )
        : [];
    const candidates = preferred.length > 0 ? preferred : input.stairs;
    const containsPosition = (stair: StairFireRegion): boolean =>
        input.position.x >= stair.min.x - 0.35
        && input.position.x <= stair.max.x + 0.35
        && input.position.y >= stair.min.y - 0.35
        && input.position.y <= stair.max.y + 0.35;
    const containing = isStairLayer(input.currentLayer)
        ? candidates.filter(containsPosition)
        : [];
    // On a stair layer, geometry is authoritative: do not treat every stair on
    // the map as a crossing candidate merely because the raw layer has bit 0x2.
    const traversalCandidates = containing.length > 0 ? containing : candidates;
    for (const stair of traversalCandidates) {
        const center = {
            x: (stair.min.x + stair.max.x) * 0.5,
            y: (stair.min.y + stair.max.y) * 0.5,
        };
        const down = normalized(stair.downDir);
        const travel = targetBase === 1 ? down : { x: -down.x, y: -down.y };
        const halfWidth = Math.max(0.1, (stair.max.x - stair.min.x) * 0.5);
        const halfHeight = Math.max(0.1, (stair.max.y - stair.min.y) * 0.5);
        const halfAlong = Math.abs(travel.x) * halfWidth + Math.abs(travel.y) * halfHeight;
        const extent = halfAlong + padding;
        const entry = {
            x: center.x - travel.x * extent,
            y: center.y - travel.y * extent,
        };
        const exit = {
            x: center.x + travel.x * extent,
            y: center.y + travel.y * extent,
        };
        const inside = containsPosition(stair);
        const crossing = isStairLayer(input.currentLayer) || inside;
        const point = crossing ? exit : entry;
        const score = distance(input.position, point)
            + distance(exit, input.target) * 0.32
            + distance(entry, input.position) * 0.08;
        if (score >= bestScore) continue;
        bestScore = score;
        best = {
            point,
            entry,
            exit,
            structureId: stair.structureId,
            stairIndex: stair.stairIndex,
            phase: crossing ? "cross" : "approach",
        };
    }
    return best;
}
