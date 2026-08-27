import type { Vec2 } from "../../../shared/utils/v2.ts";

export type GasEscapePhase = "early" | "mid" | "late" | "final";

export interface GasEscapeCircle {
    center: Vec2;
    radius: number;
}

export interface GasEscapeTargetRequest {
    myPos: Vec2;
    current: GasEscapeCircle;
    future?: GasEscapeCircle | null;
    phase: GasEscapePhase;
    urgent: boolean;
    mapWidth: number;
    mapHeight: number;
    candidateSeed?: number;
    /** Stable per-bot seed used to split a mass rotation into several lanes. */
    spreadSeed?: number;
    /** 0 = clear, 0.5 = navigable detour, 1+ = effectively blocked. */
    pathPenalty?: (point: Vec2) => number;
}

export interface GasEscapeLatchState {
    active: boolean;
    holdUntil: number;
}

export interface GasEscapeLatchRequest extends GasEscapeLatchState {
    timestamp: number;
    /** The ordinary pre-emptive escape test is currently true. */
    trigger: boolean;
    /** The bot is far enough inside the future safe circle to release the latch. */
    releaseSafe: boolean;
    minimumHoldMs?: number;
    retryHoldMs?: number;
}

export interface GasRotationDeadlineRequest {
    phase: GasEscapePhase;
    remainingSeconds: number;
    travelSeconds: number;
    armed: boolean;
    factionMode: boolean;
    newlyJoined: boolean;
    recentlyStuck: boolean;
    moving: boolean;
    gasT: number;
    staggerSeed?: number;
}

export interface GasRotationDeadline {
    trigger: boolean;
    deadlineBuffer: number;
    deadlineReached: boolean;
    movingPressure: boolean;
    hardMovingDeadline: boolean;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

const normalize = (value: Vec2, fallback: Vec2 = { x: 1, y: 0 }): Vec2 => {
    const length = Math.hypot(value.x, value.y);
    return length > 1e-5
        ? { x: value.x / length, y: value.y / length }
        : { ...fallback };
};

const rotate = (value: Vec2, radians: number): Vec2 => ({
    x: value.x * Math.cos(radians) - value.y * Math.sin(radians),
    y: value.x * Math.sin(radians) + value.y * Math.cos(radians),
});

const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (value: Vec2, scale: number): Vec2 => ({ x: value.x * scale, y: value.y * scale });

/**
 * Computes the pre-emptive rotation deadline independently from navigation.
 * Dry/unarmed bots receive more safety time, never an extra looting grace period.
 */
export function evaluateGasRotationDeadline(
    request: GasRotationDeadlineRequest,
): GasRotationDeadline {
    const baseBuffer = request.phase === "final"
        ? 3.2
        : request.phase === "late"
        ? 5
        : request.phase === "mid"
        ? 7
        : 8.5;
    const loadoutAdjustment = !request.armed
        ? request.factionMode
            ? 4.2
            : 2.8
        : 0;
    const joinAdjustment = request.newlyJoined && !request.armed ? 1.2 : 0;
    const stuckAdjustment = request.recentlyStuck ? 4.5 : 0;
    const seed = Math.trunc(request.staggerSeed ?? 0);
    const individualStagger = (((seed % 9) + 9) % 9 - 4) * 0.32;
    const deadlineBuffer = Math.max(
        1.2,
        baseBuffer
            + loadoutAdjustment
            + joinAdjustment
            + stuckAdjustment
            + individualStagger,
    );
    const deadlineReached = request.remainingSeconds <= request.travelSeconds + deadlineBuffer;
    const movingPressure = request.moving
        && request.gasT >= 0.35
        && request.remainingSeconds <= request.travelSeconds + deadlineBuffer + 2.5;
    const hardMovingDeadline = request.moving
        && request.gasT
            >= (request.phase === "early"
                ? 0.3
                : request.phase === "mid"
                ? 0.24
                : 0.16);
    return {
        trigger: deadlineReached || movingPressure || hardMovingDeadline,
        deadlineBuffer,
        deadlineReached,
        movingPressure,
        hardMovingDeadline,
    };
}

function safeMargin(phase: GasEscapePhase): number {
    switch (phase) {
        case "final":
            return 7;
        case "late":
            return 9;
        case "mid":
            return 11;
        default:
            return 13;
    }
}

function pointOnSafeRing(
    circle: GasEscapeCircle,
    direction: Vec2,
    phase: GasEscapePhase,
    extraMargin = 0,
): Vec2 {
    const radius = Math.max(1.5, circle.radius - safeMargin(phase) - extraMargin);
    return add(circle.center, mul(normalize(direction), radius));
}

function clampToMap(point: Vec2, width: number, height: number): Vec2 {
    const margin = 1.5;
    return {
        x: clamp(point.x, margin, Math.max(margin, width - margin)),
        y: clamp(point.y, margin, Math.max(margin, height - margin)),
    };
}

/**
 * Chooses a gas escape destination rather than only a movement direction.
 * It considers the current safe circle, the announced next circle, multiple
 * tangential alternatives around buildings, and a caller-provided path cost.
 */
export function selectGasEscapeTarget(request: GasEscapeTargetRequest): Vec2 {
    const {
        myPos,
        current,
        future,
        phase,
        urgent,
        mapWidth,
        mapHeight,
        candidateSeed = 0,
        spreadSeed = 0,
        pathPenalty,
    } = request;

    const currentDirection = normalize(
        { x: myPos.x - current.center.x, y: myPos.y - current.center.y },
        { x: 1, y: 0 },
    );
    const rawFutureDirection = future
        ? normalize(
            { x: myPos.x - future.center.x, y: myPos.y - future.center.y },
            currentDirection,
        )
        : currentDirection;
    const spreadDegrees = ((Math.abs(Math.trunc(spreadSeed)) % 9) - 4) * 4;
    const spreadRadians = (spreadDegrees * Math.PI) / 180;
    const laneCurrentDirection = rotate(currentDirection, spreadRadians);
    const futureDirection = rotate(rawFutureDirection, spreadRadians);

    const candidates: Vec2[] = [];
    const push = (point: Vec2): void => {
        const clamped = clampToMap(point, mapWidth, mapHeight);
        if (!candidates.some((candidate) => distance(candidate, clamped) < 0.75)) {
            candidates.push(clamped);
        }
    };

    push(pointOnSafeRing(current, laneCurrentDirection, phase));
    push(pointOnSafeRing(current, laneCurrentDirection, phase, 5));
    push(current.center);

    if (future && future.radius > 1) {
        push(pointOnSafeRing(future, futureDirection, phase, urgent ? 1 : 4));
        push(pointOnSafeRing(future, laneCurrentDirection, phase, urgent ? 0 : 3));
        push(future.center);
    }

    // Tangential alternatives allow the local navigator to select a door or
    // route around a building instead of pushing against the same wall.
    const baseOffsets = [18, -18, 34, -34, 52, -52];
    const rotatedOffsets = candidateSeed % 2 === 0 ? baseOffsets : baseOffsets.map((value) => -value);
    for (const degrees of rotatedOffsets) {
        const direction = rotate(laneCurrentDirection, (degrees * Math.PI) / 180);
        push(pointOnSafeRing(current, direction, phase, degrees % 34 === 0 ? 2 : 0));
        if (future && !urgent) {
            const futureTangent = rotate(futureDirection, (degrees * Math.PI) / 180);
            push(pointOnSafeRing(future, futureTangent, phase, 3));
        }
    }

    const currentSafeRadius = Math.max(1, current.radius - safeMargin(phase));
    const futureSafeRadius = future
        ? Math.max(1, future.radius - safeMargin(phase) - (urgent ? 0 : 3))
        : 0;

    let best = candidates[0] ?? current.center;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
        const routePenalty = Math.max(0, Number(pathPenalty?.(candidate) ?? 0));
        const currentOverflow = Math.max(
            0,
            distance(candidate, current.center) - currentSafeRadius,
        );
        const futureOverflow = future
            ? Math.max(0, distance(candidate, future.center) - futureSafeRadius)
            : 0;
        const travel = distance(myPos, candidate);
        const currentCenterPull = distance(candidate, current.center)
            * (phase === "final" ? 0.2 : phase === "late" ? 0.08 : 0.025);
        const futurePenalty = futureOverflow * (urgent ? 5 : 30);
        const score = travel
            + currentOverflow * 80
            + futurePenalty
            + routePenalty * (urgent ? 190 : 150)
            + currentCenterPull;
        if (score < bestScore) {
            bestScore = score;
            best = candidate;
        }
    }

    return best;
}

export function isInsideGasCircle(
    point: Vec2,
    circle: GasEscapeCircle,
    phase: GasEscapePhase,
    extraMargin = 0,
): boolean {
    return distance(point, circle.center) <= Math.max(
        1,
        circle.radius - safeMargin(phase) - extraMargin,
    );
}

/**
 * Adds hysteresis to future-circle movement. Without this latch, a bot standing
 * on the exact future safe boundary can alternate between gas escape and loot
 * on adjacent think ticks as steering nudges it a few centimetres in or out.
 */
export function updateGasEscapeLatch(
    request: GasEscapeLatchRequest,
): GasEscapeLatchState {
    const minimumHoldMs = Math.max(250, request.minimumHoldMs ?? 1800);
    const retryHoldMs = Math.max(180, request.retryHoldMs ?? 650);

    if (request.trigger) {
        return {
            active: true,
            holdUntil: Math.max(request.holdUntil, request.timestamp + minimumHoldMs),
        };
    }
    if (!request.active) return { active: false, holdUntil: 0 };
    if (request.timestamp < request.holdUntil) {
        return { active: true, holdUntil: request.holdUntil };
    }
    if (!request.releaseSafe) {
        return {
            active: true,
            holdUntil: request.timestamp + retryHoldMs,
        };
    }
    return { active: false, holdUntil: 0 };
}
