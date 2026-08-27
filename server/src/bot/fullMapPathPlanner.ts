import {
    isNavigationSegmentClear,
    type NavigationBlocker,
    type NavigationCollision,
    type Point2,
    pointInsideNavigationCollision,
    segmentIntersectsNavigationCollision,
} from "./navigationController.ts";

export interface FullMapPathObstacle {
    id: number;
    layer: number;
    collision: NavigationCollision;
    /** Closed usable doors remain traversable; the local executor opens them. */
    openableDoor?: boolean;
}

export interface FullMapPathPlannerOptions {
    width: number;
    height: number;
    obstacles: readonly FullMapPathObstacle[];
    cellSize?: number;
    clearance?: number;
}

export interface FullMapPathPlan {
    waypoints: Point2[];
    visitedCells: number;
    resolvedStart: Point2;
    resolvedGoal: Point2;
}

interface HeapEntry {
    index: number;
    score: number;
}

class MinHeap {
    private readonly entries: HeapEntry[] = [];

    get length(): number {
        return this.entries.length;
    }

    clear(): void {
        this.entries.length = 0;
    }

    push(entry: HeapEntry): void {
        const entries = this.entries;
        let index = entries.length;
        entries.push(entry);
        while (index > 0) {
            const parent = (index - 1) >> 1;
            if (entries[parent].score <= entry.score) break;
            entries[index] = entries[parent];
            index = parent;
        }
        entries[index] = entry;
    }

    pop(): HeapEntry | undefined {
        const entries = this.entries;
        const first = entries[0];
        const last = entries.pop();
        if (!first || !last || entries.length === 0) return first;

        let index = 0;
        while (true) {
            const left = index * 2 + 1;
            if (left >= entries.length) break;
            const right = left + 1;
            const child = right < entries.length
                    && entries[right].score < entries[left].score
                ? right
                : left;
            if (entries[child].score >= last.score) break;
            entries[index] = entries[child];
            index = child;
        }
        entries[index] = last;
        return first;
    }
}

const distance = (a: Point2, b: Point2): number => Math.hypot(a.x - b.x, a.y - b.y);
const floorLayer = (layer: number): 0 | 1 => (Number(layer) & 0x1) as 0 | 1;

const expandCollision = (
    collision: NavigationCollision,
    padding: number,
): NavigationCollision =>
    collision.type === 0
        ? {
            type: 0,
            pos: collision.pos,
            rad: Math.max(0.05, collision.rad + padding),
        }
        : {
            type: 1,
            min: { x: collision.min.x - padding, y: collision.min.y - padding },
            max: { x: collision.max.x + padding, y: collision.max.y + padding },
        };

/**
 * Match-wide navigation raster. It is deliberately independent of bot mode:
 * battle royale, faction, zombie, duel and extraction all feed movement goals
 * into the same planner. Combat/local steering remains responsible for the
 * final few metres and for dynamic actors.
 */
export class FullMapPathPlanner {
    readonly width: number;
    readonly height: number;
    readonly cellSize: number;
    readonly clearance: number;
    readonly columns: number;
    readonly rows: number;
    readonly obstacleCount: number;

    private readonly blocked: [Uint8Array, Uint8Array];
    private readonly visitGeneration: Uint32Array;
    private readonly closedGeneration: Uint32Array;
    private readonly gScore: Float64Array;
    private readonly parent: Int32Array;
    private readonly floodQueue: Int32Array;
    private readonly heap = new MinHeap();
    private readonly exactBlockerBuckets: [Map<number, NavigationBlocker[]>, Map<number, NavigationBlocker[]>];
    private readonly openableDoors: [FullMapPathObstacle[], FullMapPathObstacle[]];
    private readonly exactBucketSize = 16;
    private readonly exactBucketColumns: number;
    private readonly exactBucketRows: number;
    private generation = 0;

    constructor(options: FullMapPathPlannerOptions) {
        this.width = Math.max(2, Number(options.width) || 2);
        this.height = Math.max(2, Number(options.height) || 2);
        this.cellSize = Math.max(1.25, Number(options.cellSize ?? 2.5) || 2.5);
        this.clearance = Math.max(0.1, Number(options.clearance ?? 1) || 1);
        this.columns = Math.max(1, Math.ceil(this.width / this.cellSize));
        this.rows = Math.max(1, Math.ceil(this.height / this.cellSize));
        const cellCount = this.columns * this.rows;
        this.blocked = [new Uint8Array(cellCount), new Uint8Array(cellCount)];
        this.visitGeneration = new Uint32Array(cellCount);
        this.closedGeneration = new Uint32Array(cellCount);
        this.gScore = new Float64Array(cellCount);
        this.parent = new Int32Array(cellCount);
        this.floodQueue = new Int32Array(cellCount);
        this.exactBlockerBuckets = [new Map(), new Map()];
        this.openableDoors = [[], []];
        this.exactBucketColumns = Math.max(1, Math.ceil(this.width / this.exactBucketSize));
        this.exactBucketRows = Math.max(1, Math.ceil(this.height / this.exactBucketSize));

        let obstacleCount = 0;
        for (const obstacle of options.obstacles) {
            // A usable door is a portal, not a wall. The existing short-range
            // interaction code opens it when the route reaches the doorway.
            if (obstacle.openableDoor) {
                this.openableDoors[floorLayer(obstacle.layer)].push(obstacle);
                continue;
            }
            obstacleCount++;
            this.indexExactBlocker(floorLayer(obstacle.layer), obstacle);
            this.rasterize(
                floorLayer(obstacle.layer),
                expandCollision(obstacle.collision, this.clearance),
            );
        }
        this.obstacleCount = obstacleCount;
        this.rasterizeMapEdges();
    }

    /** True when the complete-grid segment is traversable on this floor. */
    isSegmentClear(from: Point2, to: Point2, layer: number): boolean {
        if (
            from.x < this.clearance
            || from.y < this.clearance
            || from.x > this.width - this.clearance
            || from.y > this.height - this.clearance
            || to.x < this.clearance
            || to.y < this.clearance
            || to.x > this.width - this.clearance
            || to.y > this.height - this.clearance
        ) {
            return false;
        }
        return isNavigationSegmentClear(
            from,
            to,
            this.exactSegmentBlockers(from, to, floorLayer(layer)),
            this.clearance,
        );
    }

    /** Whether a geometrically clear segment still requires opening a door. */
    requiresDoorInteraction(from: Point2, to: Point2, layer: number): boolean {
        return this.openableDoors[floorLayer(layer)].some((door) =>
            this.segmentCrossesDoorPortal(from, to, door.collision)
        );
    }

    plan(
        from: Point2,
        to: Point2,
        layer: number,
        maxVisited = 180_000,
    ): FullMapPathPlan | null {
        const floor = floorLayer(layer);
        const start = this.nearestWalkable(from, floor, 10);
        const goal = this.nearestWalkable(to, floor, 14);
        if (start < 0 || goal < 0) return null;

        const resolvedStart = this.cellCenter(start);
        const resolvedGoal = this.cellCenter(goal);
        if (this.isSegmentClear(from, to, floor)) {
            return {
                waypoints: this.insertDoorPortalWaypoints(
                    from,
                    [{ x: to.x, y: to.y }],
                    floor,
                ),
                visitedCells: 0,
                resolvedStart,
                resolvedGoal: { x: to.x, y: to.y },
            };
        }

        this.generation = (this.generation + 1) >>> 0;
        if (this.generation === 0) {
            this.visitGeneration.fill(0);
            this.closedGeneration.fill(0);
            this.generation = 1;
        }
        const generation = this.generation;
        this.heap.clear();
        this.visitGeneration[start] = generation;
        this.gScore[start] = 0;
        this.parent[start] = -1;
        this.heap.push({ index: start, score: this.heuristic(start, goal) });

        let visitedCells = 0;
        let found = false;
        const visitLimit = Math.min(
            this.columns * this.rows,
            Math.max(1_000, Math.floor(maxVisited)),
        );
        while (this.heap.length > 0 && visitedCells < visitLimit) {
            const current = this.heap.pop()!;
            if (this.closedGeneration[current.index] === generation) continue;
            this.closedGeneration[current.index] = generation;
            visitedCells++;
            if (current.index === goal) {
                found = true;
                break;
            }
            this.visitNeighbours(current.index, goal, floor, generation);
        }
        if (!found) return null;

        const cells: number[] = [];
        let cursor = goal;
        while (cursor >= 0) {
            cells.push(cursor);
            if (cursor === start) break;
            cursor = this.parent[cursor];
        }
        if (cells[cells.length - 1] !== start) return null;
        cells.reverse();

        const rawPoints = cells.map((index) => this.cellCenter(index));
        rawPoints[0] = { x: from.x, y: from.y };
        const targetIsWalkable = this.pointIndex(to) === goal;
        if (targetIsWalkable && this.isSegmentClear(rawPoints.at(-1)!, to, floor)) {
            rawPoints[rawPoints.length - 1] = { x: to.x, y: to.y };
        }
        const smoothed = this.smooth(rawPoints, floor);
        if (!smoothed) return null;
        const waypoints = this.insertDoorPortalWaypoints(from, smoothed, floor);
        return { waypoints, visitedCells, resolvedStart, resolvedGoal };
    }

    /**
     * Resolve many topology queries from one origin with one flood fill. This
     * is intentionally waypoint-free: central command uses it to discard
     * entrances belonging to another sealed bunker network before assigning
     * the ordinary A* movement route.
     */
    reachableTargets(
        from: Point2,
        targets: readonly Point2[],
        layer: number,
        maxVisited = 180_000,
    ): boolean[] {
        const reachable = targets.map(() => false);
        if (targets.length === 0) return reachable;
        const floor = floorLayer(layer);
        const start = this.nearestWalkable(from, floor, 10);
        if (start < 0) return reachable;

        const targetIndices = new Map<number, number[]>();
        for (let index = 0; index < targets.length; index++) {
            const target = this.nearestWalkable(targets[index], floor, 14);
            if (target < 0) continue;
            // Match plan(): an exact clear segment remains valid even when a
            // narrow portal has no conservative raster cell at its centre.
            if (this.isSegmentClear(from, targets[index], floor)) {
                reachable[index] = true;
                continue;
            }
            const targetList = targetIndices.get(target) ?? [];
            targetList.push(index);
            targetIndices.set(target, targetList);
        }
        if (targetIndices.size === 0) return reachable;

        this.generation = (this.generation + 1) >>> 0;
        if (this.generation === 0) {
            this.visitGeneration.fill(0);
            this.closedGeneration.fill(0);
            this.generation = 1;
        }
        const generation = this.generation;
        let remaining = targetIndices.size;
        let head = 0;
        let tail = 0;
        let visited = 0;
        this.floodQueue[tail++] = start;
        this.closedGeneration[start] = generation;
        const markTarget = (cell: number): void => {
            const matches = targetIndices.get(cell);
            if (!matches) return;
            for (const index of matches) reachable[index] = true;
            targetIndices.delete(cell);
            remaining--;
        };
        markTarget(start);
        const visitLimit = Math.min(
            this.columns * this.rows,
            Math.max(1_000, Math.floor(maxVisited)),
        );
        while (head < tail && visited < visitLimit && remaining > 0) {
            const current = this.floodQueue[head++];
            visited++;
            const x = current % this.columns;
            const y = Math.floor(current / this.columns);
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || nx >= this.columns || ny < 0 || ny >= this.rows) continue;
                    const next = ny * this.columns + nx;
                    if (
                        this.blocked[floor][next]
                        || this.closedGeneration[next] === generation
                    ) continue;
                    if (
                        dx !== 0
                        && dy !== 0
                        && (
                            this.blocked[floor][y * this.columns + nx]
                            || this.blocked[floor][ny * this.columns + x]
                        )
                    ) continue;
                    if (
                        !this.isSegmentClear(
                            this.cellCenter(current),
                            this.cellCenter(next),
                            floor,
                        )
                    ) continue;
                    this.closedGeneration[next] = generation;
                    this.floodQueue[tail++] = next;
                    markTarget(next);
                }
            }
        }
        return reachable;
    }

    private rasterizeMapEdges(): void {
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.columns; x++) {
                const center = this.cellCenterXY(x, y);
                if (
                    center.x < this.clearance
                    || center.y < this.clearance
                    || center.x > this.width - this.clearance
                    || center.y > this.height - this.clearance
                ) {
                    const index = y * this.columns + x;
                    this.blocked[0][index] = 1;
                    this.blocked[1][index] = 1;
                }
            }
        }
    }

    private rasterize(layer: 0 | 1, collision: NavigationCollision): void {
        const min = collision.type === 0
            ? { x: collision.pos.x - collision.rad, y: collision.pos.y - collision.rad }
            : collision.min;
        const max = collision.type === 0
            ? { x: collision.pos.x + collision.rad, y: collision.pos.y + collision.rad }
            : collision.max;
        const minX = Math.max(0, Math.floor(min.x / this.cellSize));
        const minY = Math.max(0, Math.floor(min.y / this.cellSize));
        const maxX = Math.min(this.columns - 1, Math.floor(max.x / this.cellSize));
        const maxY = Math.min(this.rows - 1, Math.floor(max.y / this.cellSize));
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const center = this.cellCenterXY(x, y);
                const inside = collision.type === 0
                    ? distance(center, collision.pos) <= collision.rad
                    : center.x >= collision.min.x
                        && center.x <= collision.max.x
                        && center.y >= collision.min.y
                        && center.y <= collision.max.y;
                if (inside) this.blocked[layer][y * this.columns + x] = 1;
            }
        }
    }

    private nearestWalkable(point: Point2, layer: 0 | 1, maxRadius: number): number {
        const baseX = Math.max(0, Math.min(this.columns - 1, Math.floor(point.x / this.cellSize)));
        const baseY = Math.max(0, Math.min(this.rows - 1, Math.floor(point.y / this.cellSize)));
        let best = -1;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let radius = 0; radius <= maxRadius; radius++) {
            for (let y = baseY - radius; y <= baseY + radius; y++) {
                if (y < 0 || y >= this.rows) continue;
                for (let x = baseX - radius; x <= baseX + radius; x++) {
                    if (x < 0 || x >= this.columns) continue;
                    if (radius > 0 && Math.abs(x - baseX) !== radius && Math.abs(y - baseY) !== radius) {
                        continue;
                    }
                    const index = y * this.columns + x;
                    if (this.blocked[layer][index]) continue;
                    const candidateDistance = distance(point, this.cellCenterXY(x, y));
                    if (candidateDistance < bestDistance) {
                        best = index;
                        bestDistance = candidateDistance;
                    }
                }
            }
            if (best >= 0) return best;
        }
        return -1;
    }

    private visitNeighbours(
        current: number,
        goal: number,
        layer: 0 | 1,
        generation: number,
    ): void {
        const x = current % this.columns;
        const y = Math.floor(current / this.columns);
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || nx >= this.columns || ny < 0 || ny >= this.rows) continue;
                const next = ny * this.columns + nx;
                if (
                    this.blocked[layer][next]
                    || this.closedGeneration[next] === generation
                ) {
                    continue;
                }
                if (
                    !this.isSegmentClear(
                        this.cellCenter(current),
                        this.cellCenter(next),
                        layer,
                    )
                ) {
                    continue;
                }
                // Never squeeze diagonally through two touching wall corners.
                if (
                    dx !== 0
                    && dy !== 0
                    && (
                        this.blocked[layer][y * this.columns + nx]
                        || this.blocked[layer][ny * this.columns + x]
                    )
                ) {
                    continue;
                }
                const step = dx === 0 || dy === 0 ? 1 : Math.SQRT2;
                const tentative = this.gScore[current]
                    + step
                    + this.wallProximityPenalty(nx, ny, layer);
                if (
                    this.visitGeneration[next] === generation
                    && tentative >= this.gScore[next]
                ) {
                    continue;
                }
                this.visitGeneration[next] = generation;
                this.gScore[next] = tentative;
                this.parent[next] = current;
                this.heap.push({
                    index: next,
                    score: tentative + this.heuristic(next, goal),
                });
            }
        }
    }

    private wallProximityPenalty(x: number, y: number, layer: 0 | 1): number {
        let adjacentWalls = 0;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx;
                const ny = y + dy;
                if (
                    nx < 0
                    || nx >= this.columns
                    || ny < 0
                    || ny >= this.rows
                    || this.blocked[layer][ny * this.columns + nx]
                ) {
                    adjacentWalls++;
                }
            }
        }
        return adjacentWalls * 0.035;
    }

    private heuristic(from: number, to: number): number {
        const fromX = from % this.columns;
        const fromY = Math.floor(from / this.columns);
        const toX = to % this.columns;
        const toY = Math.floor(to / this.columns);
        const dx = Math.abs(fromX - toX);
        const dy = Math.abs(fromY - toY);
        return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
    }

    private smooth(points: readonly Point2[], layer: 0 | 1): Point2[] | null {
        if (points.length <= 1) return points.map((point) => ({ ...point }));
        const result: Point2[] = [];
        let anchor = 0;
        while (anchor < points.length - 1) {
            let next = points.length - 1;
            while (
                next > anchor + 1
                && !this.isSegmentClear(points[anchor], points[next], layer)
            ) {
                next--;
            }
            if (!this.isSegmentClear(points[anchor], points[next], layer)) return null;
            result.push({ x: points[next].x, y: points[next].y });
            anchor = next;
        }
        return result;
    }

    private insertDoorPortalWaypoints(
        from: Point2,
        waypoints: readonly Point2[],
        layer: 0 | 1,
    ): Point2[] {
        const doors = this.openableDoors[layer];
        if (doors.length === 0) return waypoints.map((point) => ({ ...point }));
        const result: Point2[] = [];
        const usedDoors = new Set<number>();
        let anchor = { x: from.x, y: from.y };
        for (const endpoint of waypoints) {
            const segmentX = endpoint.x - anchor.x;
            const segmentY = endpoint.y - anchor.y;
            const segmentLengthSq = segmentX * segmentX + segmentY * segmentY;
            const crossedDoors = doors
                .filter((door) => !usedDoors.has(door.id))
                .filter((door) => this.segmentCrossesDoorPortal(anchor, endpoint, door.collision))
                .map((door) => {
                    const center = this.collisionCenter(door.collision);
                    const along = segmentLengthSq <= 1e-8
                        ? 0
                        : (
                            (center.x - anchor.x) * segmentX
                            + (center.y - anchor.y) * segmentY
                        ) / segmentLengthSq;
                    return { door, along };
                })
                .filter((entry) => entry.along >= -0.05 && entry.along <= 1.05)
                .sort((a, b) => a.along - b.along);

            for (const { door } of crossedDoors) {
                const expandedDoor = expandCollision(door.collision, this.clearance);
                if (
                    result.length > 0
                    && pointInsideNavigationCollision(result[result.length - 1], expandedDoor)
                ) {
                    result.pop();
                }
                const routeAnchor = result.at(-1) ?? from;
                const portal = this.doorPortalPoints(routeAnchor, endpoint, door.collision);
                if (
                    !this.isSegmentClear(routeAnchor, portal.approach, layer)
                    || !this.isSegmentClear(portal.approach, portal.exit, layer)
                    || !this.isSegmentClear(portal.exit, endpoint, layer)
                ) {
                    continue;
                }
                this.pushDistinctPoint(result, portal.approach);
                this.pushDistinctPoint(result, portal.center);
                this.pushDistinctPoint(result, portal.exit);
                usedDoors.add(door.id);
                anchor = portal.exit;
            }
            this.pushDistinctPoint(result, endpoint);
            anchor = { x: endpoint.x, y: endpoint.y };
        }
        return result;
    }

    private segmentCrossesDoorPortal(
        from: Point2,
        to: Point2,
        collision: NavigationCollision,
    ): boolean {
        const expanded = expandCollision(collision, this.clearance);
        if (!segmentIntersectsNavigationCollision(from, to, expanded)) return false;
        if (collision.type === 0) {
            return segmentIntersectsNavigationCollision(from, to, collision);
        }
        const center = this.collisionCenter(collision);
        const width = collision.max.x - collision.min.x;
        const height = collision.max.y - collision.min.y;
        const fromSide = width <= height ? from.x - center.x : from.y - center.y;
        const toSide = width <= height ? to.x - center.x : to.y - center.y;
        return fromSide === 0 || toSide === 0 || Math.sign(fromSide) !== Math.sign(toSide);
    }

    private doorPortalPoints(
        from: Point2,
        to: Point2,
        collision: NavigationCollision,
    ): { approach: Point2; center: Point2; exit: Point2 } {
        const center = this.collisionCenter(collision);
        const travelLength = Math.hypot(to.x - from.x, to.y - from.y);
        const travel = travelLength > 1e-6
            ? { x: (to.x - from.x) / travelLength, y: (to.y - from.y) / travelLength }
            : { x: 1, y: 0 };
        let normal: Point2;
        let halfThickness: number;
        if (collision.type === 1) {
            const width = collision.max.x - collision.min.x;
            const height = collision.max.y - collision.min.y;
            if (width <= height) {
                normal = { x: 1, y: 0 };
                halfThickness = width * 0.5;
            } else {
                normal = { x: 0, y: 1 };
                halfThickness = height * 0.5;
            }
        } else {
            normal = travel;
            halfThickness = collision.rad;
        }
        if (normal.x * travel.x + normal.y * travel.y < 0) {
            normal = { x: -normal.x, y: -normal.y };
        }
        const offset = halfThickness + this.clearance + 0.42;
        return {
            approach: {
                x: center.x - normal.x * offset,
                y: center.y - normal.y * offset,
            },
            center,
            exit: {
                x: center.x + normal.x * offset,
                y: center.y + normal.y * offset,
            },
        };
    }

    private collisionCenter(collision: NavigationCollision): Point2 {
        return collision.type === 0
            ? { x: collision.pos.x, y: collision.pos.y }
            : {
                x: (collision.min.x + collision.max.x) * 0.5,
                y: (collision.min.y + collision.max.y) * 0.5,
            };
    }

    private pushDistinctPoint(points: Point2[], point: Point2): void {
        const previous = points.at(-1);
        if (previous && distance(previous, point) <= 0.08) return;
        points.push({ x: point.x, y: point.y });
    }

    private indexExactBlocker(
        layer: 0 | 1,
        obstacle: FullMapPathObstacle,
    ): void {
        const collision = obstacle.collision;
        const pos = collision.type === 0
            ? collision.pos
            : {
                x: (collision.min.x + collision.max.x) * 0.5,
                y: (collision.min.y + collision.max.y) * 0.5,
            };
        const radius = collision.type === 0
            ? collision.rad
            : Math.hypot(
                collision.max.x - collision.min.x,
                collision.max.y - collision.min.y,
            ) * 0.5;
        const blocker: NavigationBlocker = {
            id: obstacle.id,
            pos,
            radius,
            collision,
        };
        const min = collision.type === 0
            ? {
                x: collision.pos.x - collision.rad - this.clearance,
                y: collision.pos.y - collision.rad - this.clearance,
            }
            : {
                x: collision.min.x - this.clearance,
                y: collision.min.y - this.clearance,
            };
        const max = collision.type === 0
            ? {
                x: collision.pos.x + collision.rad + this.clearance,
                y: collision.pos.y + collision.rad + this.clearance,
            }
            : {
                x: collision.max.x + this.clearance,
                y: collision.max.y + this.clearance,
            };
        const minBucketX = this.exactBucketX(min.x);
        const minBucketY = this.exactBucketY(min.y);
        const maxBucketX = this.exactBucketX(max.x);
        const maxBucketY = this.exactBucketY(max.y);
        const buckets = this.exactBlockerBuckets[layer];
        for (let y = minBucketY; y <= maxBucketY; y++) {
            for (let x = minBucketX; x <= maxBucketX; x++) {
                const key = y * this.exactBucketColumns + x;
                const entries = buckets.get(key);
                if (entries) entries.push(blocker);
                else buckets.set(key, [blocker]);
            }
        }
    }

    private exactSegmentBlockers(
        from: Point2,
        to: Point2,
        layer: 0 | 1,
    ): NavigationBlocker[] {
        const minBucketX = this.exactBucketX(
            Math.min(from.x, to.x) - this.clearance,
        );
        const minBucketY = this.exactBucketY(
            Math.min(from.y, to.y) - this.clearance,
        );
        const maxBucketX = this.exactBucketX(
            Math.max(from.x, to.x) + this.clearance,
        );
        const maxBucketY = this.exactBucketY(
            Math.max(from.y, to.y) + this.clearance,
        );
        const buckets = this.exactBlockerBuckets[layer];
        const candidates: NavigationBlocker[] = [];
        const seen = new Set<number>();
        for (let y = minBucketY; y <= maxBucketY; y++) {
            for (let x = minBucketX; x <= maxBucketX; x++) {
                const entries = buckets.get(y * this.exactBucketColumns + x);
                if (!entries) continue;
                for (const blocker of entries) {
                    if (seen.has(blocker.id)) continue;
                    seen.add(blocker.id);
                    candidates.push(blocker);
                }
            }
        }
        return candidates;
    }

    private exactBucketX(value: number): number {
        return Math.max(
            0,
            Math.min(
                this.exactBucketColumns - 1,
                Math.floor(value / this.exactBucketSize),
            ),
        );
    }

    private exactBucketY(value: number): number {
        return Math.max(
            0,
            Math.min(
                this.exactBucketRows - 1,
                Math.floor(value / this.exactBucketSize),
            ),
        );
    }

    private pointIndex(point: Point2): number {
        const x = Math.floor(point.x / this.cellSize);
        const y = Math.floor(point.y / this.cellSize);
        if (x < 0 || x >= this.columns || y < 0 || y >= this.rows) return -1;
        return y * this.columns + x;
    }

    private cellCenter(index: number): Point2 {
        return this.cellCenterXY(index % this.columns, Math.floor(index / this.columns));
    }

    private cellCenterXY(x: number, y: number): Point2 {
        return {
            x: Math.min(this.width, (x + 0.5) * this.cellSize),
            y: Math.min(this.height, (y + 0.5) * this.cellSize),
        };
    }
}
