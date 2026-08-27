export interface Point2 {
    x: number;
    y: number;
}

export type NavigationCollision =
    | { type: 0; pos: Point2; rad: number }
    | { type: 1; min: Point2; max: Point2 };

export interface NavigationBlocker {
    id: number;
    pos: Point2;
    radius: number;
    /** Exact transformed world-space collider. Radius remains a legacy fallback. */
    collision?: NavigationCollision;
    openableDoor?: boolean;
}

export interface NavigationCollisionDefinition {
    collision?: {
        type?: number;
        rad?: number;
        min?: { x?: number; y?: number };
        max?: { x?: number; y?: number };
    };
    extents?: { x?: number; y?: number };
}

/** Conservative circle used only by local movement steering. */
export function navigationRadiusFromDefinition(
    definition: NavigationCollisionDefinition | undefined,
    scale = 1,
    fallback = 1.1,
): number {
    const safeScale = Math.max(0.1, Number(scale) || 1);
    const collision = definition?.collision;
    if (collision?.type === 0 && Number(collision.rad) > 0) {
        return Math.max(0.35, Number(collision.rad) * safeScale);
    }
    const min = collision?.min;
    const max = collision?.max;
    if (min && max) {
        const halfX = Math.max(0.1, Math.abs(Number(max.x ?? 0) - Number(min.x ?? 0)) / 2);
        const halfY = Math.max(0.1, Math.abs(Number(max.y ?? 0) - Number(min.y ?? 0)) / 2);
        return Math.max(0.4, Math.hypot(halfX, halfY) * safeScale);
    }
    if (definition?.extents) {
        return Math.max(
            0.4,
            Math.hypot(
                Number(definition.extents.x ?? 0),
                Number(definition.extents.y ?? 0),
            ) * safeScale,
        );
    }
    return Math.max(0.35, fallback * safeScale);
}

export interface LocalSteeringOptions {
    clearance?: number;
    preferredSide?: -1 | 1;
    bounds?: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface LocalSteeringPlan {
    direction: Point2;
    waypoint: Point2;
    blockerId: number;
    blocked: boolean;
    approachDoor: boolean;
}

export interface StuckRecoveryOptions extends LocalSteeringOptions {
    desiredDirection: Point2;
    previousDirection?: Point2;
    attempt?: number;
    maxProbeDistance?: number;
}

export interface StuckRecoveryPlan {
    direction: Point2;
    clearance: number;
    score: number;
}

export interface IndoorDoorRouteCandidate {
    id: number;
    pos: Point2;
    open?: boolean;
    approachClear?: boolean;
    targetSideClear?: boolean;
}

export interface IndoorDoorRouteScore {
    id: number;
    score: number;
}

/**
 * Scores a door as an indoor route waypoint. The route is deliberately
 * biased toward doors that can be reached from the current room and that have
 * usable space on their far side. This avoids selecting a visually nearby
 * door through an intervening wall and reduces door-to-door oscillation in
 * multi-room buildings.
 */
export function scoreIndoorDoorRoute(
    from: Point2,
    target: Point2,
    candidate: IndoorDoorRouteCandidate,
): IndoorDoorRouteScore {
    const targetDirection = normalize(sub(target, from));
    const doorDirection = normalize(sub(candidate.pos, from), targetDirection);
    const alignment = dot(doorDirection, targetDirection);
    const approachPenalty = candidate.approachClear === false ? 24 : 0;
    const farSidePenalty = candidate.targetSideClear === false ? 9 : 0;
    const openBonus = candidate.open ? 2.2 : 0;
    const score = distance(from, candidate.pos) * 1.22
        + distance(candidate.pos, target) * 0.34
        - alignment * 5.2
        + approachPenalty
        + farSidePenalty
        - openBonus;
    return { id: candidate.id, score };
}

const length = (point: Point2): number => Math.hypot(point.x, point.y);
const sub = (a: Point2, b: Point2): Point2 => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point2, b: Point2): Point2 => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Point2, scale: number): Point2 => ({ x: a.x * scale, y: a.y * scale });
const distance = (a: Point2, b: Point2): number => length(sub(a, b));
const dot = (a: Point2, b: Point2): number => a.x * b.x + a.y * b.y;
const normalize = (point: Point2, fallback: Point2 = { x: 1, y: 0 }): Point2 => {
    const magnitude = length(point);
    return magnitude > 1e-6
        ? { x: point.x / magnitude, y: point.y / magnitude }
        : fallback;
};
const perpendicular = (point: Point2): Point2 => ({ x: -point.y, y: point.x });

const segmentDistance = (a: Point2, b: Point2, point: Point2): number => {
    const ab = sub(b, a);
    const abLengthSq = dot(ab, ab);
    if (abLengthSq <= 1e-9) return distance(a, point);
    const t = Math.max(0, Math.min(1, dot(sub(point, a), ab) / abLengthSq));
    return distance(add(a, mul(ab, t)), point);
};

const insideBounds = (
    point: Point2,
    bounds: LocalSteeringOptions["bounds"],
): boolean =>
    !bounds
    || (point.x >= bounds.minX
        && point.x <= bounds.maxX
        && point.y >= bounds.minY
        && point.y <= bounds.maxY);

const expandedCollision = (
    blocker: NavigationBlocker,
    clearance: number,
): NavigationCollision => {
    if (blocker.collision?.type === 0) {
        return {
            type: 0,
            pos: blocker.collision.pos,
            rad: Math.max(0.2, blocker.collision.rad + clearance),
        };
    }
    if (blocker.collision?.type === 1) {
        return {
            type: 1,
            min: {
                x: blocker.collision.min.x - clearance,
                y: blocker.collision.min.y - clearance,
            },
            max: {
                x: blocker.collision.max.x + clearance,
                y: blocker.collision.max.y + clearance,
            },
        };
    }
    return {
        type: 0,
        pos: blocker.pos,
        rad: Math.max(0.2, blocker.radius + clearance),
    };
};

export const pointInsideNavigationCollision = (
    point: Point2,
    collision: NavigationCollision,
): boolean =>
    collision.type === 0
        ? distance(point, collision.pos) < collision.rad
        : point.x > collision.min.x
            && point.x < collision.max.x
            && point.y > collision.min.y
            && point.y < collision.max.y;

interface CollisionInterval {
    entry: number;
    exit: number;
}

/** Distance interval along a normalized ray occupied by a collider. */
const rayCollisionInterval = (
    from: Point2,
    direction: Point2,
    collision: NavigationCollision,
    maximum: number,
): CollisionInterval | null => {
    if (collision.type === 0) {
        const relative = sub(collision.pos, from);
        const along = dot(relative, direction);
        const perpendicularSq = Math.max(0, dot(relative, relative) - along * along);
        const radiusSq = collision.rad * collision.rad;
        if (perpendicularSq >= radiusSq) return null;
        const halfChord = Math.sqrt(radiusSq - perpendicularSq);
        const entry = along - halfChord;
        const exit = along + halfChord;
        if (exit < 0 || entry > maximum) return null;
        return { entry: Math.max(0, entry), exit: Math.min(maximum, exit) };
    }

    let entry = 0;
    let exit = maximum;
    for (const axis of ["x", "y"] as const) {
        const origin = from[axis];
        const velocity = direction[axis];
        const min = collision.min[axis];
        const max = collision.max[axis];
        if (Math.abs(velocity) < 1e-8) {
            if (origin < min || origin > max) return null;
            continue;
        }
        const t1 = (min - origin) / velocity;
        const t2 = (max - origin) / velocity;
        entry = Math.max(entry, Math.min(t1, t2));
        exit = Math.min(exit, Math.max(t1, t2));
        if (entry > exit) return null;
    }
    if (exit < 0 || entry > maximum) return null;
    return { entry: Math.max(0, entry), exit: Math.min(maximum, exit) };
};

export const segmentIntersectsNavigationCollision = (
    from: Point2,
    to: Point2,
    collision: NavigationCollision,
): boolean => {
    const delta = sub(to, from);
    const maximum = length(delta);
    if (maximum <= 1e-8) return pointInsideNavigationCollision(from, collision);
    return rayCollisionInterval(from, mul(delta, 1 / maximum), collision, maximum) !== null;
};

const firstBlocker = (
    from: Point2,
    to: Point2,
    blockers: readonly NavigationBlocker[],
    clearance: number,
    ignoredBlockerIds: ReadonlySet<number> = new Set<number>(),
): NavigationBlocker | null => {
    const ray = sub(to, from);
    const rayLength = length(ray);
    if (rayLength <= 1e-9) return null;
    const direction = mul(ray, 1 / rayLength);

    let best: NavigationBlocker | null = null;
    let bestAlong = Number.POSITIVE_INFINITY;
    for (const blocker of blockers) {
        if (ignoredBlockerIds.has(blocker.id)) continue;
        const interval = rayCollisionInterval(
            from,
            direction,
            expandedCollision(blocker, clearance),
            rayLength,
        );
        if (!interval) continue;
        // Starting inside/against a wall must remain blocked; the old center
        // projection discarded these collisions and made bots push into walls.
        if (interval.entry < bestAlong) {
            best = blocker;
            bestAlong = interval.entry;
        }
    }
    return best;
};

/**
 * Exact actor-clearance segment test shared by the indoor visibility graph and
 * local steering. Keeping this in the same module prevents the room planner
 * from using a looser collision model than the final movement executor.
 */
export function isNavigationSegmentClear(
    from: Point2,
    to: Point2,
    blockers: readonly NavigationBlocker[],
    clearance = 0.85,
    ignoredBlockerIds: ReadonlySet<number> = new Set<number>(),
): boolean {
    return firstBlocker(
        from,
        to,
        blockers,
        Math.max(0, clearance),
        ignoredBlockerIds,
    ) === null;
}

/**
 * Short-range obstacle steering used for loot, crates, doors and exploration.
 * It is deliberately local rather than a server-authoritative pathfinder: the
 * bot only uses obstacles currently present in its client object pool.
 */
export function planLocalSteering(
    from: Point2,
    to: Point2,
    blockers: readonly NavigationBlocker[],
    options: LocalSteeringOptions = {},
): LocalSteeringPlan {
    const direct = normalize(sub(to, from));
    const clearance = Math.max(0, options.clearance ?? 0.85);
    const blocker = firstBlocker(from, to, blockers, clearance);
    if (!blocker) {
        return {
            direction: direct,
            waypoint: { x: to.x, y: to.y },
            blockerId: 0,
            blocked: false,
            approachDoor: false,
        };
    }

    if (blocker.openableDoor) {
        return {
            direction: normalize(sub(blocker.pos, from), direct),
            waypoint: { x: blocker.pos.x, y: blocker.pos.y },
            blockerId: blocker.id,
            blocked: true,
            approachDoor: true,
        };
    }

    const collision = expandedCollision(blocker, clearance + 0.55);
    const preferred: -1 | 1 = options.preferredSide ?? 1;

    // If the client snapshot places the player inside an inflated wall, leave
    // through the nearest face first. This is deterministic and cannot point
    // deeper into the same wall.
    if (pointInsideNavigationCollision(from, collision)) {
        let waypoint: Point2;
        if (collision.type === 0) {
            const away = normalize(sub(from, collision.pos), perpendicular(direct));
            waypoint = add(collision.pos, mul(away, collision.rad + 0.35));
        } else {
            const exits = [
                { point: { x: collision.min.x - 0.35, y: from.y }, cost: from.x - collision.min.x },
                { point: { x: collision.max.x + 0.35, y: from.y }, cost: collision.max.x - from.x },
                { point: { x: from.x, y: collision.min.y - 0.35 }, cost: from.y - collision.min.y },
                { point: { x: from.x, y: collision.max.y + 0.35 }, cost: collision.max.y - from.y },
            ].filter((candidate) => insideBounds(candidate.point, options.bounds));
            exits.sort((a, b) => a.cost - b.cost);
            waypoint = exits[0]?.point ?? add(from, mul(perpendicular(direct), preferred * 3));
        }
        return {
            direction: normalize(sub(waypoint, from), mul(direct, -1)),
            waypoint,
            blockerId: blocker.id,
            blocked: true,
            approachDoor: false,
        };
    }

    const candidates: Point2[] = [];
    if (collision.type === 1) {
        const pad = 0.3;
        candidates.push(
            { x: collision.min.x - pad, y: collision.min.y - pad },
            { x: collision.min.x - pad, y: collision.max.y + pad },
            { x: collision.max.x + pad, y: collision.min.y - pad },
            { x: collision.max.x + pad, y: collision.max.y + pad },
        );
    } else {
        const side = perpendicular(direct);
        const forwardOffset = Math.min(2.4, Math.max(0.75, collision.rad * 0.65));
        candidates.push(
            add(collision.pos, add(mul(side, collision.rad * preferred), mul(direct, forwardOffset))),
            add(collision.pos, add(mul(side, collision.rad * -preferred), mul(direct, forwardOffset))),
        );
    }

    // A corner around the first collision is not useful when another wall or
    // fixture blocks either leg. Validate against the rest of the local blocker
    // set so dense rooms do not alternate between two geometrically invalid
    // corners. The first blocker is excluded here because these points are the
    // deliberate tangent bypass around its inflated boundary.
    const remainingBlockers = blockers.filter((candidate) => candidate.id !== blocker.id);
    const selected = candidates
        .filter((point) => insideBounds(point, options.bounds))
        .filter(
            (point) =>
                isNavigationSegmentClear(from, point, remainingBlockers, clearance)
                && isNavigationSegmentClear(point, to, remainingBlockers, clearance),
        )
        .map((point, index) => ({
            point,
            cost: distance(from, point)
                + distance(point, to)
                + (index === 0 ? 0 : 0.65),
        }))
        .sort((a, b) => a.cost - b.cost)[0];

    if (!selected) {
        const tangent = mul(perpendicular(direct), preferred);
        return {
            direction: tangent,
            waypoint: add(from, mul(tangent, 4)),
            blockerId: blocker.id,
            blocked: true,
            approachDoor: false,
        };
    }

    return {
        direction: normalize(sub(selected.point, from), direct),
        waypoint: selected.point,
        blockerId: blocker.id,
        blocked: true,
        approachDoor: false,
    };
}

const rotate = (direction: Point2, radians: number): Point2 => {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
        x: direction.x * cos - direction.y * sin,
        y: direction.x * sin + direction.y * cos,
    };
};

const rayDistanceToBounds = (
    from: Point2,
    direction: Point2,
    bounds: LocalSteeringOptions["bounds"],
    maximum: number,
): number => {
    if (!bounds) return maximum;
    let distanceToEdge = maximum;
    if (direction.x > 1e-6) {
        distanceToEdge = Math.min(distanceToEdge, (bounds.maxX - from.x) / direction.x);
    } else if (direction.x < -1e-6) {
        distanceToEdge = Math.min(distanceToEdge, (bounds.minX - from.x) / direction.x);
    }
    if (direction.y > 1e-6) {
        distanceToEdge = Math.min(distanceToEdge, (bounds.maxY - from.y) / direction.y);
    } else if (direction.y < -1e-6) {
        distanceToEdge = Math.min(distanceToEdge, (bounds.minY - from.y) / direction.y);
    }
    return Math.max(0, Math.min(maximum, distanceToEdge));
};

const freeDistanceAlongRay = (
    from: Point2,
    direction: Point2,
    blockers: readonly NavigationBlocker[],
    clearance: number,
    bounds: LocalSteeringOptions["bounds"],
    maximum: number,
): number => {
    let freeDistance = rayDistanceToBounds(from, direction, bounds, maximum);
    let overlappingUntil = 0;
    for (const blocker of blockers) {
        const collision = expandedCollision(blocker, clearance);
        const interval = rayCollisionInterval(from, direction, collision, maximum);
        if (!interval) continue;
        if (pointInsideNavigationCollision(from, collision)) {
            overlappingUntil = Math.max(overlappingUntil, interval.exit);
            continue;
        }
        if (interval.entry > overlappingUntil && interval.entry < freeDistance) {
            freeDistance = interval.entry;
        }
    }
    return Math.max(0, Math.min(maximum, freeDistance - overlappingUntil));
};

/**
 * Chooses a committed escape direction when ordinary steering has made no
 * progress. Unlike a random turn, it samples the local free space around the
 * player and deliberately changes side on repeated attempts.
 */
export function planStuckRecovery(
    from: Point2,
    blockers: readonly NavigationBlocker[],
    options: StuckRecoveryOptions,
): StuckRecoveryPlan {
    const desired = normalize(options.desiredDirection);
    const previous = options.previousDirection
        ? normalize(options.previousDirection)
        : null;
    const attempt = Math.max(1, Math.floor(options.attempt ?? 1));
    const clearance = Math.max(0.15, options.clearance ?? 0.85);
    const maxProbeDistance = Math.max(3, options.maxProbeDistance ?? 9);
    const preferredSign: -1 | 1 = attempt % 2 === 0 ? -1 : 1;
    const angleSteps = [
        0,
        30,
        -30,
        55,
        -55,
        85,
        -85,
        120,
        -120,
        150,
        -150,
        180,
    ];

    let best: StuckRecoveryPlan = { direction: mul(desired, -1), clearance: 0, score: -Infinity };
    for (const degrees of angleSteps) {
        const direction = normalize(rotate(desired, (degrees * Math.PI) / 180));
        const freeDistance = freeDistanceAlongRay(
            from,
            direction,
            blockers,
            clearance,
            options.bounds,
            maxProbeDistance,
        );
        const alignment = dot(direction, desired);
        const side = Math.sign(desired.x * direction.y - desired.y * direction.x);
        const stableSideBonus = side === preferredSign ? 0.8 : 0;
        const repeatPenalty = previous && dot(direction, previous) > 0.92
            ? attempt >= 6
                ? 48
                : Math.min(12, attempt * 2.4)
            : 0;
        const reverseBonus = attempt >= 3 && alignment < -0.35 ? 1.8 : 0;
        const blockedPenalty = freeDistance < 1.1 ? 18 : freeDistance < 2.2 ? 5 : 0;
        const score = freeDistance * 4.2
            + alignment * (attempt <= 1 ? 3.5 : 1.5)
            + stableSideBonus
            + reverseBonus
            - repeatPenalty
            - blockedPenalty;
        if (score > best.score) {
            best = { direction, clearance: freeDistance, score };
        }
    }
    return best;
}
