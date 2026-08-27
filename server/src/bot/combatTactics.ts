export interface Vec2Like {
    x: number;
    y: number;
}

const EPSILON = 1e-6;

const add = (a: Vec2Like, b: Vec2Like): Vec2Like => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec2Like, b: Vec2Like): Vec2Like => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Vec2Like, scalar: number): Vec2Like => ({ x: a.x * scalar, y: a.y * scalar });
const dot = (a: Vec2Like, b: Vec2Like): number => a.x * b.x + a.y * b.y;
const length = (value: Vec2Like): number => Math.hypot(value.x, value.y);
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const normalizeVector = (
    value: Vec2Like,
    fallback: Vec2Like = { x: 1, y: 0 },
): Vec2Like => {
    const size = length(value);
    if (!Number.isFinite(size) || size <= EPSILON) {
        const fallbackSize = length(fallback);
        return fallbackSize > EPSILON
            ? { x: fallback.x / fallbackSize, y: fallback.y / fallbackSize }
            : { x: 1, y: 0 };
    }
    return { x: value.x / size, y: value.y / size };
};

export interface InterceptAimContext {
    shooterPos: Vec2Like;
    targetPos: Vec2Like;
    targetVelocity: Vec2Like;
    targetAcceleration?: Vec2Like;
    projectileSpeed: number;
    leadFactor: number;
    reactionSeconds?: number;
    maxLeadSeconds?: number;
}

/**
 * Solves a constant-velocity projectile intercept and then applies a bounded
 * acceleration correction. The correction is deliberately conservative: a
 * rapidly changing strafe should not make the bot aim far outside the target's
 * current movement corridor.
 */
export function predictInterceptPoint(context: InterceptAimContext): {
    point: Vec2Like;
    interceptSeconds: number;
} {
    const relative = sub(context.targetPos, context.shooterPos);
    const velocity = context.targetVelocity ?? { x: 0, y: 0 };
    const projectileSpeed = Math.max(20, Number(context.projectileSpeed) || 20);
    const maxLead = clamp(Number(context.maxLeadSeconds) || 0.7, 0.04, 0.9);

    const a = dot(velocity, velocity) - projectileSpeed * projectileSpeed;
    const b = 2 * dot(relative, velocity);
    const c = dot(relative, relative);
    let time = Math.sqrt(c) / projectileSpeed;

    if (Math.abs(a) <= EPSILON) {
        if (Math.abs(b) > EPSILON) {
            const linear = -c / b;
            if (linear > 0) time = linear;
        }
    } else {
        const discriminant = b * b - 4 * a * c;
        if (discriminant >= 0) {
            const root = Math.sqrt(discriminant);
            const t1 = (-b - root) / (2 * a);
            const t2 = (-b + root) / (2 * a);
            const positive = [t1, t2].filter((value) => value > 0 && Number.isFinite(value));
            if (positive.length > 0) time = Math.min(...positive);
        }
    }

    const reaction = clamp(Number(context.reactionSeconds) || 0, 0, 0.18);
    time = clamp((time + reaction) * clamp(context.leadFactor, 0.35, 1.35), 0.015, maxLead);

    const acceleration = context.targetAcceleration ?? { x: 0, y: 0 };
    const accelerationMagnitude = length(acceleration);
    const boundedAcceleration = accelerationMagnitude > 22
        ? mul(normalizeVector(acceleration), 22)
        : acceleration;
    const accelerationWeight = time <= 0.16 ? 0.18 : time <= 0.35 ? 0.34 : 0.46;
    const correction = mul(boundedAcceleration, 0.5 * time * time * accelerationWeight);
    const point = add(context.targetPos, add(mul(velocity, time), correction));
    return { point, interceptSeconds: time };
}

export interface CloseRangeMovementContext {
    myPos: Vec2Like;
    enemyPos: Vec2Like;
    enemyVelocity: Vec2Like;
    enemyFacing?: Vec2Like;
    desiredDistance: number;
    strafeSign: number;
    health: number;
    recentlyDamaged: boolean;
    targetDistance: number;
}

/**
 * Produces a stable close-range orbit. It avoids mirrored movement by biasing
 * against the opponent's current lateral velocity and widens the orbit when the
 * opponent is already aiming at the bot.
 */
export function closeRangeCombatDirection(context: CloseRangeMovementContext): Vec2Like {
    const toEnemy = normalizeVector(sub(context.enemyPos, context.myPos));
    const side = { x: -toEnemy.y, y: toEnemy.x };
    const enemyLateral = dot(context.enemyVelocity, side);
    let sign = context.strafeSign >= 0 ? 1 : -1;
    if (Math.abs(enemyLateral) > 0.8) sign = enemyLateral > 0 ? -1 : 1;

    const enemyFacing = normalizeVector(context.enemyFacing ?? mul(toEnemy, -1), mul(toEnemy, -1));
    const enemyToBot = mul(toEnemy, -1);
    const aimPressure = clamp((dot(enemyFacing, enemyToBot) - 0.35) / 0.65, 0, 1);
    const desiredDistance = Math.max(3.4, context.desiredDistance);
    const distanceError = context.targetDistance - desiredDistance;
    const radial = clamp(distanceError / Math.max(3.5, desiredDistance * 0.45), -1.15, 1.15);
    const panic = context.recentlyDamaged || context.health < 34;
    const lateralWeight = 1.05 + aimPressure * 0.55 + (panic ? 0.24 : 0);
    const radialWeight = panic && distanceError < 0 ? 1.35 : 0.72;
    return normalizeVector(
        add(mul(side, sign * lateralWeight), mul(toEnemy, radial * radialWeight)),
        mul(side, sign),
    );
}

export interface CoverGeometryContext {
    obstaclePos: Vec2Like;
    obstacleRadius: number;
    /** World-space AABB half extents when the obstacle is not circular. */
    obstacleHalfExtents?: Vec2Like;
    enemyPos: Vec2Like;
    playerRadius?: number;
    peekPadding?: number;
}

export interface CoverGeometry {
    anchor: Vec2Like;
    leftPeek: Vec2Like;
    rightPeek: Vec2Like;
    awayFromEnemy: Vec2Like;
}

/**
 * Computes a fully hidden anchor and two side-peek points around a circularized
 * obstacle. The anchor stays deeper than the player's collider radius so the
 * character sprite/collider does not leak around the edge while waiting.
 */
export function coverGeometry(context: CoverGeometryContext): CoverGeometry {
    const away = normalizeVector(sub(context.obstaclePos, context.enemyPos));
    const side = { x: -away.y, y: away.x };
    const obstacleRadius = Math.max(0.55, Number(context.obstacleRadius) || 0.55);
    const halfExtents = context.obstacleHalfExtents;
    // For a rectangle, its projection on the escape bearing is a conservative
    // support distance. This keeps the anchor outside long walls/containers;
    // treating them as a small name-derived circle can put the target inside.
    const obstacleReach = halfExtents
        ? Math.max(
            obstacleRadius,
            Math.abs(away.x) * Math.max(0, Number(halfExtents.x) || 0)
                + Math.abs(away.y) * Math.max(0, Number(halfExtents.y) || 0),
        )
        : obstacleRadius;
    const playerRadius = Math.max(0.55, Number(context.playerRadius) || 0.72);
    const peekPadding = Math.max(0.15, Number(context.peekPadding) || 0.42);
    const anchorDistance = obstacleReach + playerRadius + 0.42;
    const peekForward = obstacleReach + playerRadius * 0.58;
    const peekSide = obstacleReach + playerRadius + peekPadding;
    return {
        anchor: add(context.obstaclePos, mul(away, anchorDistance)),
        leftPeek: add(context.obstaclePos, add(mul(away, peekForward), mul(side, peekSide))),
        rightPeek: add(context.obstaclePos, add(mul(away, peekForward), mul(side, -peekSide))),
        awayFromEnemy: away,
    };
}

export function obstacleBlocksBody(
    enemyPos: Vec2Like,
    bodyPos: Vec2Like,
    obstaclePos: Vec2Like,
    obstacleRadius: number,
    playerRadius = 0.72,
): boolean {
    const segment = sub(bodyPos, enemyPos);
    const denominator = dot(segment, segment);
    if (denominator <= EPSILON) return false;
    const t = clamp(dot(sub(obstaclePos, enemyPos), segment) / denominator, 0, 1);
    const closest = add(enemyPos, mul(segment, t));
    const clearance = length(sub(closest, obstaclePos));
    return clearance <= Math.max(0.4, obstacleRadius) + Math.max(0.45, playerRadius) * 0.72;
}

/**
 * Conservative hard-cover check for the full player collider. The obstacle
 * must intersect the threat ray to the body centre and to both lateral edges;
 * a tangent that only clips the centre line is not safe enough for healing.
 */
export function obstacleBlocksFullBody(
    enemyPos: Vec2Like,
    bodyPos: Vec2Like,
    obstaclePos: Vec2Like,
    obstacleRadius: number,
    playerRadius = 0.72,
): boolean {
    const line = sub(bodyPos, enemyPos);
    const lineLength = length(line);
    if (lineLength <= EPSILON) return false;
    const direction = mul(line, 1 / lineLength);
    const side = { x: -direction.y, y: direction.x };
    const bodyEdge = Math.max(0.45, playerRadius);
    const radius = Math.max(0.4, obstacleRadius);
    const endpoints = [
        bodyPos,
        add(bodyPos, mul(side, bodyEdge)),
        add(bodyPos, mul(side, -bodyEdge)),
    ];
    return endpoints.every((endpoint) => {
        const segment = sub(endpoint, enemyPos);
        const denominator = dot(segment, segment);
        if (denominator <= EPSILON) return false;
        const rawT = dot(sub(obstaclePos, enemyPos), segment) / denominator;
        if (rawT <= 0.001 || rawT >= 0.999) return false;
        const closest = add(enemyPos, mul(segment, rawT));
        return length(sub(closest, obstaclePos)) <= radius;
    });
}

export interface PeekCycleContext {
    phase: "none" | "hide" | "peek" | "return";
    timestamp: number;
    phaseUntil: number;
    alignedForShot: boolean;
    firedDuringPeek: boolean;
    automatic: boolean;
    fireDelayMs: number;
}

export function nextPeekPhase(context: PeekCycleContext): {
    phase: "hide" | "peek" | "return";
    durationMs: number;
} {
    if (context.phase === "none") return { phase: "hide", durationMs: 380 };
    if (context.phase === "hide" && context.timestamp >= context.phaseUntil) {
        return { phase: "peek", durationMs: context.automatic ? 300 : clamp(context.fireDelayMs + 150, 250, 430) };
    }
    if (
        context.phase === "peek"
        && (context.timestamp >= context.phaseUntil || (context.alignedForShot && context.firedDuringPeek))
    ) {
        return { phase: "return", durationMs: 240 };
    }
    if (context.phase === "return" && context.timestamp >= context.phaseUntil) {
        return { phase: "hide", durationMs: context.automatic ? 430 : 520 };
    }
    return { phase: context.phase, durationMs: Math.max(1, context.phaseUntil - context.timestamp) };
}
