export interface IndoorPoint {
    x: number;
    y: number;
}

export interface IndoorRegion {
    min: IndoorPoint;
    max: IndoorPoint;
}

const distance = (a: IndoorPoint, b: IndoorPoint): number => Math.hypot(a.x - b.x, a.y - b.y);

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/**
 * Builds a deterministic room sweep from exact building floor/ceiling AABBs.
 * Large rooms receive quadrant probes; narrow corridors retain a center probe.
 */
export function buildIndoorSearchProbes(
    regions: readonly IndoorRegion[] | undefined,
    fallbackCenter: IndoorPoint,
    inset = 1.15,
    startPoint: IndoorPoint = fallbackCenter,
    routeCost: (from: IndoorPoint, to: IndoorPoint) => number = distance,
): IndoorPoint[] {
    if (!regions?.length) return [{ x: fallbackCenter.x, y: fallbackCenter.y }];
    const probes: IndoorPoint[] = [];
    for (const region of regions) {
        const width = Math.max(0, region.max.x - region.min.x);
        const height = Math.max(0, region.max.y - region.min.y);
        const minX = Math.min(region.max.x, region.min.x + Math.min(inset, width * 0.24));
        const maxX = Math.max(region.min.x, region.max.x - Math.min(inset, width * 0.24));
        const minY = Math.min(region.max.y, region.min.y + Math.min(inset, height * 0.24));
        const maxY = Math.max(region.min.y, region.max.y - Math.min(inset, height * 0.24));
        const center = { x: (region.min.x + region.max.x) * 0.5, y: (region.min.y + region.max.y) * 0.5 };
        probes.push(center);
        if (width >= 7 || height >= 7) {
            probes.push(
                { x: clamp(center.x - width * 0.24, minX, maxX), y: clamp(center.y - height * 0.24, minY, maxY) },
                { x: clamp(center.x + width * 0.24, minX, maxX), y: clamp(center.y - height * 0.24, minY, maxY) },
                { x: clamp(center.x + width * 0.24, minX, maxX), y: clamp(center.y + height * 0.24, minY, maxY) },
                { x: clamp(center.x - width * 0.24, minX, maxX), y: clamp(center.y + height * 0.24, minY, maxY) },
            );
        }
    }

    const unique: IndoorPoint[] = [];
    for (const point of probes) {
        if (unique.some((existing) => distance(existing, point) < 2.2)) continue;
        unique.push(point);
    }
    // Nearest-neighbour ordering reduces repeated cross-room traversal.
    const ordered: IndoorPoint[] = [];
    let cursor = startPoint;
    while (unique.length > 0) {
        unique.sort((a, b) => routeCost(cursor, a) - routeCost(cursor, b));
        const next = unique.shift()!;
        ordered.push(next);
        cursor = next;
    }
    return ordered;
}
