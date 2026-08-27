export const FLOOR_PURSUIT_MEMORY_MS = 9000;
export const PURSUIT_ANCHOR_RADIUS = 3.2;

const baseFloor = (layer: number): number => Number(layer) & 0x1;

/** Movement decision only; this function never grants firing permission. */
export function floorPursuitRequired(currentLayer: number, targetLayer: number): boolean {
    return baseFloor(currentLayer) !== baseFloor(targetLayer);
}

/**
 * A target can be last seen on a stair half (2/3) and then be observed on the
 * destination base floor (0/1). Preserve that current contact long enough to
 * commit to a real connector instead of requiring the two samples to match.
 */
export function retainChangedFloorContact(input: {
    memoryLayer: number;
    observedLayer: number;
    memoryAgeMs: number;
    currentTarget: boolean;
    lockedTraversal: boolean;
}): boolean {
    if (!Number.isFinite(input.memoryAgeMs) || input.memoryAgeMs < 0) {
        return false;
    }
    if (input.lockedTraversal) return true;
    if (input.memoryAgeMs > FLOOR_PURSUIT_MEMORY_MS) return false;
    if (input.memoryLayer === input.observedLayer) return true;
    return input.currentTarget || input.lockedTraversal;
}

export function pursuitSearchPhase(input: {
    floorChangeRequired: boolean;
    distanceToAnchor: number;
    arrivalRadius?: number;
}): "approach" | "sweep" {
    const radius = Math.max(0.5, input.arrivalRadius ?? PURSUIT_ANCHOR_RADIUS);
    return !input.floorChangeRequired && input.distanceToAnchor <= radius
        ? "sweep"
        : "approach";
}
