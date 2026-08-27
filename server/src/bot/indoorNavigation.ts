export interface IndoorNavigationPoint {
    x: number;
    y: number;
}

export interface IndoorNavigationDoor {
    id: number;
    pos: IndoorNavigationPoint;
    open?: boolean;
}

export interface IndoorDoorPortal {
    doorId: number;
    center: IndoorNavigationPoint;
    sideA: IndoorNavigationPoint;
    sideB: IndoorNavigationPoint;
    axis: IndoorNavigationPoint;
    clearanceA: number;
    clearanceB: number;
    open: boolean;
}

export type IndoorRouteWaypointKind = "corner" | "door-approach" | "door" | "door-exit";

export interface IndoorRouteWaypoint {
    kind: IndoorRouteWaypointKind;
    point: IndoorNavigationPoint;
    doorId: number;
}

export interface IndoorPortalRoutePlan {
    cost: number;
    doorIds: number[];
    waypoints: IndoorRouteWaypoint[];
    portals: IndoorDoorPortal[];
}

export interface IndoorPortalPlannerOptions {
    portalProbeDistance?: number;
    portalOffset?: number;
    closedDoorCost?: number;
    maxDoors?: number;
    /** Optional traversal penalty used to discourage outdoor detours. */
    pointPenalty?: (point: IndoorNavigationPoint) => number;
}

export type IndoorSegmentClear = (
    from: IndoorNavigationPoint,
    to: IndoorNavigationPoint,
    ignoredDoorIds: ReadonlySet<number>,
) => boolean;

export interface OpenBoundaryExitOptions {
    angleSteps?: number;
    probeDistances?: readonly number[];
    isStandable?: (point: IndoorNavigationPoint) => boolean;
}

const add = (a: IndoorNavigationPoint, b: IndoorNavigationPoint): IndoorNavigationPoint => ({
    x: a.x + b.x,
    y: a.y + b.y,
});
const sub = (a: IndoorNavigationPoint, b: IndoorNavigationPoint): IndoorNavigationPoint => ({
    x: a.x - b.x,
    y: a.y - b.y,
});
const mul = (a: IndoorNavigationPoint, scale: number): IndoorNavigationPoint => ({
    x: a.x * scale,
    y: a.y * scale,
});
const dot = (a: IndoorNavigationPoint, b: IndoorNavigationPoint): number => a.x * b.x + a.y * b.y;
const length = (a: IndoorNavigationPoint): number => Math.hypot(a.x, a.y);
const distance = (a: IndoorNavigationPoint, b: IndoorNavigationPoint): number => length(sub(a, b));
const normalize = (
    point: IndoorNavigationPoint,
    fallback: IndoorNavigationPoint = { x: 1, y: 0 },
): IndoorNavigationPoint => {
    const magnitude = length(point);
    return magnitude > 1e-7 ? mul(point, 1 / magnitude) : fallback;
};
const rotate = (point: IndoorNavigationPoint, radians: number): IndoorNavigationPoint => ({
    x: point.x * Math.cos(radians) - point.y * Math.sin(radians),
    y: point.x * Math.sin(radians) + point.y * Math.cos(radians),
});

const pointKey = (point: IndoorNavigationPoint): string => `${Math.round(point.x * 100)}:${Math.round(point.y * 100)}`;

/**
 * Find a walkable opening in a roof/building boundary that has no door object.
 * Small shacks, containers and several event buildings use a literal gap
 * between wall colliders, so a door-only portal graph cannot represent their
 * perfectly valid exit. Sampling is ordered around the final objective but
 * covers the complete circle to retain side and rear exits.
 */
export function selectOpenBoundaryExit(
    from: IndoorNavigationPoint,
    target: IndoorNavigationPoint,
    isInsideBoundary: (point: IndoorNavigationPoint) => boolean,
    isSegmentClear: (from: IndoorNavigationPoint, to: IndoorNavigationPoint) => boolean,
    options: OpenBoundaryExitOptions = {},
): IndoorNavigationPoint | null {
    const angleSteps = Math.max(12, Math.floor(options.angleSteps ?? 36));
    const distances = (options.probeDistances ?? [4, 6, 8.5, 11, 15, 20, 27, 35, 44])
        .filter((value) => Number.isFinite(value) && value > 0.5)
        .sort((a, b) => a - b);
    if (distances.length === 0) return null;

    const targetDirection = normalize(sub(target, from));
    const targetAngle = Math.atan2(targetDirection.y, targetDirection.x);
    let best: { point: IndoorNavigationPoint; score: number } | null = null;
    for (let rank = 0; rank < angleSteps; rank += 1) {
        const signedStep = rank === 0
            ? 0
            : Math.ceil(rank / 2) * (rank % 2 === 1 ? 1 : -1);
        const angle = targetAngle + signedStep * (Math.PI * 2 / angleSteps);
        const direction = { x: Math.cos(angle), y: Math.sin(angle) };
        for (const probeDistance of distances) {
            const point = add(from, mul(direction, probeDistance));
            if (isInsideBoundary(point)) continue;
            if (options.isStandable && !options.isStandable(point)) continue;
            if (!isSegmentClear(from, point)) continue;
            const alignment = dot(direction, targetDirection);
            const score = alignment * 9 - probeDistance * 0.035 - rank * 0.012;
            if (!best || score > best.score) best = { point, score };
            // The nearest outside point on this ray is the safest crossing.
            break;
        }
    }
    return best?.point ?? null;
}

const appendWaypoint = (
    output: IndoorRouteWaypoint[],
    waypoint: IndoorRouteWaypoint,
): void => {
    const previous = output[output.length - 1];
    if (
        previous
        && previous.kind === waypoint.kind
        && previous.doorId === waypoint.doorId
        && distance(previous.point, waypoint.point) < 0.15
    ) {
        return;
    }
    output.push(waypoint);
};

function probeFreeDistance(
    center: IndoorNavigationPoint,
    direction: IndoorNavigationPoint,
    doorId: number,
    maximum: number,
    isSegmentClear: IndoorSegmentClear,
): number {
    const ignored = new Set<number>([doorId]);
    const start = add(center, mul(direction, 0.22));
    const probes = [1, 0.84, 0.68, 0.52, 0.38, 0.26].map((ratio) => maximum * ratio);
    for (const probe of probes) {
        if (probe < 0.85) continue;
        const end = add(center, mul(direction, probe));
        if (isSegmentClear(start, end, ignored)) return probe;
    }
    return 0;
}

/**
 * Infers the walk-through axis of a door from the actual free space around it.
 * The map orientation field is not reliable for every custom building, so the
 * planner samples both sides of several axes and keeps the axis with usable
 * clearance on both sides. This avoids projecting the exit point into a wall
 * when the bot approaches a door diagonally.
 */
export function buildIndoorDoorPortal(
    door: IndoorNavigationDoor,
    from: IndoorNavigationPoint,
    target: IndoorNavigationPoint,
    isSegmentClear: IndoorSegmentClear,
    options: IndoorPortalPlannerOptions = {},
): IndoorDoorPortal | null {
    const maximum = Math.max(2.4, options.portalProbeDistance ?? 4.6);
    const routeDirection = normalize(sub(target, from));
    const fromOffset = sub(from, door.pos);
    const targetOffset = sub(target, door.pos);

    let best:
        | {
            axis: IndoorNavigationPoint;
            clearanceA: number;
            clearanceB: number;
            score: number;
        }
        | undefined;

    // Fifteen-degree steps are dense enough to find narrow and diagonal custom
    // doorways without relying on the object's orientation metadata.
    for (let step = 0; step < 12; step += 1) {
        const axis = rotate({ x: 1, y: 0 }, (step * Math.PI) / 12);
        const clearanceA = probeFreeDistance(
            door.pos,
            axis,
            door.id,
            maximum,
            isSegmentClear,
        );
        const clearanceB = probeFreeDistance(
            door.pos,
            mul(axis, -1),
            door.id,
            maximum,
            isSegmentClear,
        );
        const minimum = Math.min(clearanceA, clearanceB);
        if (minimum < 1.05) continue;

        // A valid doorway normally has long free space through the opening but
        // nearby jamb/wall geometry across it. Without this contrast, a diagonal
        // ray can slip through the rectangular gap and be mistaken for the door
        // normal, projecting the exit point into a corner. Measure the
        // perpendicular free space and strongly prefer the confined axis.
        const lateralAxis = rotate(axis, Math.PI * 0.5);
        const lateralA = probeFreeDistance(
            door.pos,
            lateralAxis,
            door.id,
            maximum,
            isSegmentClear,
        );
        const lateralB = probeFreeDistance(
            door.pos,
            mul(lateralAxis, -1),
            door.id,
            maximum,
            isSegmentClear,
        );
        const lateralMinimum = Math.min(lateralA, lateralB);
        const corridorContrast = Math.max(0, minimum - lateralMinimum);

        const fromSide = dot(fromOffset, axis);
        const targetSide = dot(targetOffset, axis);
        const oppositeSides = fromSide * targetSide < -0.35 ? 1 : 0;
        const alignment = Math.abs(dot(axis, routeDirection));
        const balance = 1 - Math.abs(clearanceA - clearanceB) / Math.max(0.1, clearanceA + clearanceB);
        const score = minimum * 5.4
            + (clearanceA + clearanceB) * 0.55
            + corridorContrast * 3.8
            - lateralMinimum * 0.65
            + oppositeSides * 2.4
            + alignment * 0.8
            + balance * 0.55;
        if (!best || score > best.score) {
            best = { axis, clearanceA, clearanceB, score };
        }
    }

    if (!best) return null;
    const requestedOffset = Math.max(1.05, options.portalOffset ?? 2.35);
    const offset = Math.min(
        requestedOffset,
        Math.max(1.05, Math.min(best.clearanceA, best.clearanceB) * 0.72),
    );
    return {
        doorId: door.id,
        center: { x: door.pos.x, y: door.pos.y },
        sideA: add(door.pos, mul(best.axis, offset)),
        sideB: add(door.pos, mul(best.axis, -offset)),
        axis: best.axis,
        clearanceA: best.clearanceA,
        clearanceB: best.clearanceB,
        open: Boolean(door.open),
    };
}

interface GraphNode {
    key: string;
    point: IndoorNavigationPoint;
    doorId: number;
    side: "a" | "b" | null;
}

interface GraphEdge {
    to: number;
    cost: number;
    portalDoorId: number;
}

/**
 * Builds a local visibility graph from the bot, target and both sides of every
 * usable door. A portal edge is the only edge allowed to cross a closed door.
 * Ordinary visibility edges connect points within the same room. Dijkstra then
 * naturally produces one-door or multi-door routes without needing hard-coded
 * room identifiers.
 */
export function planIndoorPortalRoute(
    from: IndoorNavigationPoint,
    target: IndoorNavigationPoint,
    doors: readonly IndoorNavigationDoor[],
    isSegmentClear: IndoorSegmentClear,
    options: IndoorPortalPlannerOptions = {},
): IndoorPortalRoutePlan | null {
    const emptyIgnored = new Set<number>();
    if (isSegmentClear(from, target, emptyIgnored)) return null;

    const maximumDoors = Math.max(1, Math.floor(options.maxDoors ?? 28));
    const midpoint = mul(add(from, target), 0.5);
    // A midpoint-only shortlist can remove the only entrance near either end of
    // a long warehouse. Reserve capacity for doors near the actor, target and
    // route midpoint, then fill the remainder by combined route relevance.
    const selected = new Map<number, IndoorNavigationDoor>();
    const reserve = Math.max(1, Math.floor(maximumDoors / 4));
    const addNearest = (point: IndoorNavigationPoint): void => {
        [...doors]
            .sort((a, b) => distance(a.pos, point) - distance(b.pos, point))
            .slice(0, reserve)
            .forEach((door) => selected.set(door.id, door));
    };
    addNearest(from);
    addNearest(target);
    addNearest(midpoint);
    [...doors]
        .sort(
            (a, b) =>
                distance(a.pos, midpoint) + distance(a.pos, from) * 0.18
                + distance(a.pos, target) * 0.12
                - (distance(b.pos, midpoint) + distance(b.pos, from) * 0.18
                    + distance(b.pos, target) * 0.12),
        )
        .forEach((door) => {
            if (selected.size < maximumDoors) selected.set(door.id, door);
        });
    const shortlisted = [...selected.values()].slice(0, maximumDoors);

    const portals = shortlisted
        .map((door) => buildIndoorDoorPortal(door, from, target, isSegmentClear, options))
        .filter((portal): portal is IndoorDoorPortal => portal !== null);
    if (portals.length === 0) return null;

    const nodes: GraphNode[] = [
        { key: "start", point: { x: from.x, y: from.y }, doorId: 0, side: null },
        { key: "target", point: { x: target.x, y: target.y }, doorId: 0, side: null },
    ];
    const sideIndex = new Map<string, number>();
    for (const portal of portals) {
        const a = nodes.length;
        nodes.push({
            key: `door:${portal.doorId}:a`,
            point: portal.sideA,
            doorId: portal.doorId,
            side: "a",
        });
        const b = nodes.length;
        nodes.push({
            key: `door:${portal.doorId}:b`,
            point: portal.sideB,
            doorId: portal.doorId,
            side: "b",
        });
        sideIndex.set(`${portal.doorId}:a`, a);
        sideIndex.set(`${portal.doorId}:b`, b);
    }

    const adjacency: GraphEdge[][] = nodes.map(() => []);
    const pointPenalty = options.pointPenalty ?? (() => 0);
    const connect = (a: number, b: number, cost: number, portalDoorId = 0): void => {
        const traversalPenalty = Math.max(
            0,
            (pointPenalty(nodes[a].point) + pointPenalty(nodes[b].point)) * 0.5,
        );
        const weightedCost = cost + traversalPenalty;
        adjacency[a].push({ to: b, cost: weightedCost, portalDoorId });
        adjacency[b].push({ to: a, cost: weightedCost, portalDoorId });
    };

    // Portal edges represent opening/passing through the door. They deliberately
    // ignore the door's own collider, while all room visibility edges below do not.
    const closedDoorCost = Math.max(0, options.closedDoorCost ?? 2.4);
    for (const portal of portals) {
        const a = sideIndex.get(`${portal.doorId}:a`)!;
        const b = sideIndex.get(`${portal.doorId}:b`)!;
        connect(
            a,
            b,
            distance(nodes[a].point, nodes[b].point) + (portal.open ? 0.3 : closedDoorCost),
            portal.doorId,
        );
    }

    for (let a = 0; a < nodes.length; a += 1) {
        for (let b = a + 1; b < nodes.length; b += 1) {
            if (nodes[a].doorId > 0 && nodes[a].doorId === nodes[b].doorId) continue;
            if (!isSegmentClear(nodes[a].point, nodes[b].point, emptyIgnored)) continue;
            // A very small edge is usually duplicate geometry and adds no route value.
            const edgeDistance = distance(nodes[a].point, nodes[b].point);
            if (edgeDistance < 0.22) continue;
            connect(a, b, edgeDistance, 0);
        }
    }

    const costs = nodes.map(() => Number.POSITIVE_INFINITY);
    const previous = nodes.map(() => -1);
    const previousPortal = nodes.map(() => 0);
    const visited = nodes.map(() => false);
    costs[0] = 0;

    for (;;) {
        let current = -1;
        let currentCost = Number.POSITIVE_INFINITY;
        for (let index = 0; index < nodes.length; index += 1) {
            if (!visited[index] && costs[index] < currentCost) {
                current = index;
                currentCost = costs[index];
            }
        }
        if (current < 0 || current === 1) break;
        visited[current] = true;
        for (const edge of adjacency[current]) {
            if (visited[edge.to]) continue;
            const nextCost = currentCost + edge.cost;
            if (nextCost + 1e-6 >= costs[edge.to]) continue;
            costs[edge.to] = nextCost;
            previous[edge.to] = current;
            previousPortal[edge.to] = edge.portalDoorId;
        }
    }

    if (!Number.isFinite(costs[1])) return null;
    const path: number[] = [];
    for (let cursor = 1; cursor >= 0; cursor = previous[cursor]) {
        path.push(cursor);
        if (cursor === 0) break;
    }
    if (path[path.length - 1] !== 0) return null;
    path.reverse();

    const portalById = new Map(portals.map((portal) => [portal.doorId, portal]));
    const waypoints: IndoorRouteWaypoint[] = [];
    const doorIds: number[] = [];
    for (let index = 1; index < path.length - 1; index += 1) {
        const nodeIndex = path[index];
        const node = nodes[nodeIndex];
        const nextIndex = path[index + 1];
        const next = nodes[nextIndex];
        const crossingDoor = previousPortal[nextIndex];
        if (
            crossingDoor > 0
            && node.doorId === crossingDoor
            && next.doorId === crossingDoor
            && node.side !== next.side
        ) {
            const portal = portalById.get(crossingDoor)!;
            appendWaypoint(waypoints, {
                kind: "door-approach",
                point: { x: node.point.x, y: node.point.y },
                doorId: crossingDoor,
            });
            appendWaypoint(waypoints, {
                kind: "door",
                point: { x: portal.center.x, y: portal.center.y },
                doorId: crossingDoor,
            });
            appendWaypoint(waypoints, {
                kind: "door-exit",
                point: { x: next.point.x, y: next.point.y },
                doorId: crossingDoor,
            });
            if (!doorIds.includes(crossingDoor)) doorIds.push(crossingDoor);
            index += 1;
            continue;
        }
        appendWaypoint(waypoints, {
            kind: "corner",
            point: { x: node.point.x, y: node.point.y },
            doorId: node.doorId,
        });
    }

    if (doorIds.length === 0 || waypoints.length === 0) return null;
    return { cost: costs[1], doorIds, waypoints, portals };
}

/** Selects the portal side opposite the actor, preferring the target side when unambiguous. */
export function portalExitPoint(
    portal: IndoorDoorPortal,
    from: IndoorNavigationPoint,
    target: IndoorNavigationPoint,
): IndoorNavigationPoint {
    const fromA = distance(from, portal.sideA);
    const fromB = distance(from, portal.sideB);
    const targetA = distance(target, portal.sideA);
    const targetB = distance(target, portal.sideB);
    const actorNearA = fromA <= fromB;
    const targetPrefersA = targetA + 0.45 < targetB;
    const targetPrefersB = targetB + 0.45 < targetA;
    if (actorNearA && targetPrefersB) return portal.sideB;
    if (!actorNearA && targetPrefersA) return portal.sideA;
    return actorNearA ? portal.sideB : portal.sideA;
}

export function indoorRouteSignature(
    fromBuildingId: number,
    targetBuildingId: number,
    target: IndoorNavigationPoint,
): string {
    return `${fromBuildingId}>${targetBuildingId}:${Math.round(target.x / 4)}:${Math.round(target.y / 4)}:${
        pointKey(target)
    }`;
}
