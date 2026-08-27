export interface Point2 {
    x: number;
    y: number;
}

export type EngagementDifficulty = "normal" | "hard" | "pro" | "legit" | "forbidden";

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const add = (a: Point2, b: Point2): Point2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Point2, b: Point2): Point2 => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Point2, scale: number): Point2 => ({ x: a.x * scale, y: a.y * scale });
const length = (a: Point2): number => Math.hypot(a.x, a.y);
const distance = (a: Point2, b: Point2): number => length(sub(a, b));
const normalize = (a: Point2, fallback: Point2 = { x: 1, y: 0 }): Point2 => {
    const magnitude = length(a);
    return magnitude > 1e-6 ? mul(a, 1 / magnitude) : fallback;
};
const perpendicular = (a: Point2): Point2 => ({ x: -a.y, y: a.x });

export function visibleTriggerDeadlineMs(
    difficulty: EngagementDifficulty,
    reactionMs: number,
): number {
    const grace = difficulty === "forbidden" || difficulty === "legit"
        ? 90
        : difficulty === "pro"
        ? 180
        : difficulty === "hard"
        ? 420
        : 980;
    return Math.max(120, reactionMs + grace);
}

/**
 * Random shoot confidence may vary the first shot, but it must not allow a bot
 * to watch a hittable enemy indefinitely. Once this deadline passes a legal,
 * in-range shot is deterministic.
 */
export function shouldForceVisibleTrigger(options: {
    difficulty: EngagementDifficulty;
    reactionMs: number;
    visibleForMs: number;
    legalLine: boolean;
    inRange: boolean;
    ammoReady: boolean;
    survivalLocked?: boolean;
    reloading?: boolean;
}): boolean {
    if (
        options.survivalLocked
        || options.reloading
        || !options.legalLine
        || !options.inRange
        || !options.ammoReady
    ) {
        return false;
    }
    return options.visibleForMs >= visibleTriggerDeadlineMs(options.difficulty, options.reactionMs);
}

/** Strongly closes distance when the currently usable weapon cannot reach. */
export function closeOutOfRangeDirection(options: {
    baseDirection: Point2;
    botPos: Point2;
    enemyPos: Point2;
    distance: number;
    weaponRange: number;
}): Point2 {
    const toEnemy = normalize(sub(options.enemyPos, options.botPos));
    const shortage = Math.max(0, options.distance - Math.max(1, options.weaponRange));
    const weight = clamp(0.62 + shortage / Math.max(8, options.weaponRange) * 0.55, 0.62, 0.94);
    return normalize(add(mul(options.baseDirection, 1 - weight), mul(toEnemy, weight)), toEnemy);
}

export interface HardCoverFlankPlan {
    point: Point2;
    sign: -1 | 1;
    score: number;
    lineClear: boolean;
}

/**
 * Produces a stable shoulder route around hard cover rather than shooting an
 * indestructible wall or strafing forever on its near side.
 */
export function chooseHardCoverFlank(options: {
    botPos: Point2;
    enemyPos: Point2;
    blockerPos: Point2;
    blockerRadius: number;
    preferredSign: -1 | 1;
    bounds?: { minX: number; minY: number; maxX: number; maxY: number };
    pathClear: (from: Point2, to: Point2) => boolean;
    shotClear: (from: Point2, to: Point2) => boolean;
}): HardCoverFlankPlan | null {
    const direct = normalize(sub(options.enemyPos, options.botPos));
    const side = perpendicular(direct);
    const shoulder = Math.max(2.6, options.blockerRadius + 1.9);
    const forward = clamp(options.blockerRadius * 0.55, 0.7, 3.2);
    const signs: Array<-1 | 1> = [
        options.preferredSign,
        options.preferredSign === 1 ? -1 : 1,
    ];
    let best: HardCoverFlankPlan | null = null;
    for (const sign of signs) {
        const point = add(
            options.blockerPos,
            add(mul(side, shoulder * sign), mul(direct, forward)),
        );
        if (
            options.bounds
            && (point.x < options.bounds.minX
                || point.x > options.bounds.maxX
                || point.y < options.bounds.minY
                || point.y > options.bounds.maxY)
        ) {
            continue;
        }
        if (!options.pathClear(options.botPos, point)) continue;
        const lineClear = options.shotClear(point, options.enemyPos);
        const score = distance(options.botPos, point)
            + distance(point, options.enemyPos) * 0.08
            - (lineClear ? 12 : 0)
            + (sign === options.preferredSign ? 0 : 0.8);
        if (!best || score < best.score) best = { point, sign, score, lineClear };
    }
    return best;
}
