export interface MovementInput {
    up: boolean;
    down: boolean;
    left: boolean;
    right: boolean;
}

/**
 * Convert a world-space direction into the keyboard movement flags understood
 * by the authoritative player simulation. Server coordinates use +Y for Up.
 */
export function movementInputFromDirection(
    direction: { x: number; y: number },
    deadzone = 0.18,
): MovementInput {
    const x = Number(direction.x);
    const y = Number(direction.y);
    const length = Math.hypot(x, y);
    if (!Number.isFinite(length) || length <= 1e-6) {
        return { up: false, down: false, left: false, right: false };
    }

    const nx = x / length;
    const ny = y / length;
    return {
        left: nx < -deadzone,
        right: nx > deadzone,
        up: ny > deadzone,
        down: ny < -deadzone,
    };
}

export interface MovementStabilityOptions {
    timestamp: number;
    lockUntil: number;
    holdMs: number;
    allowImmediate: boolean;
    deadzone?: number;
    /**
     * Max angular speed used to rotate toward a new direction inside the hold
     * window. Lower values make direction changes visibly smooth; combat can
     * pass a high value to keep strafe flips agile.
     */
    turnRateRadiansPerSecond?: number;
    /**
     * Keep the committed direction when the desired direction is within this
     * angle, so tiny per-tick steering wobble never reaches the keyboard flags.
     */
    hysteresisRadians?: number;
    /**
     * Wall-clock time since the previous stabilization call (ms). Defaults to a
     * nominal 33 ms tick so callers without real timing still rotate smoothly.
     */
    elapsedMs?: number;
}

export interface StableMovementDirection {
    direction: { x: number; y: number };
    lockUntil: number;
}

const normalizedDirection = (
    direction: { x: number; y: number },
    fallback: { x: number; y: number },
): { x: number; y: number } => {
    const x = Number(direction.x);
    const y = Number(direction.y);
    const length = Math.hypot(x, y);
    if (!Number.isFinite(length) || length <= 1e-6) return { ...fallback };
    return { x: x / length, y: y / length };
};

/**
 * Smooths movement direction changes inside a short commitment window.
 *
 * The old stabilizer only suppressed full axis flips (left<->right,
 * up<->down) and snapped to every other direction change, so a steering
 * target oscillating near a keyboard-flags boundary still produced visible
 * left/right shaking. The new stabilizer:
 *
 *  1. Keeps the committed direction while the desired direction is inside a
 *     small hysteresis angle (kills micro-wobble entirely).
 *  2. Rotates toward the desired direction at a bounded angular speed, so a
 *     real turn (including a 180 flip) is a short smooth rotation instead of
 *     a snap, and an oscillating target cannot shake the bot.
 *  3. Still snaps immediately for gas, airstrike, retreat and unstuck motion
 *     (allowImmediate) so survival movement never lags.
 */
export function stabilizeMovementDirection(
    desiredDirection: { x: number; y: number },
    committedDirection: { x: number; y: number },
    options: MovementStabilityOptions,
): StableMovementDirection {
    const committed = normalizedDirection(committedDirection, { x: 1, y: 0 });
    const desired = normalizedDirection(desiredDirection, committed);
    const holdMs = Math.max(1, options.holdMs);
    if (options.allowImmediate) {
        // Gas, airstrike, retreat and unstuck movement always snaps so the bot
        // never lags a survival turn.
        return {
            direction: desired,
            lockUntil: options.timestamp + holdMs,
        };
    }

    const angle = angleBetween(committed, desired);
    const hysteresis = Math.max(0, options.hysteresisRadians ?? 0.18);
    if (angle <= hysteresis) {
        // Micro-jitter deadband: the desired direction is effectively the same,
        // adopt it directly so a slowly drifting target re-anchors without any
        // keyboard-flag toggling.
        return { direction: desired, lockUntil: options.lockUntil };
    }

    const turnRate = Math.max(0.2, options.turnRateRadiansPerSecond ?? 3.2);
    const elapsedMs = clamp(Number(options.elapsedMs) > 0 ? Number(options.elapsedMs) : 33, 1, 120);
    const maxTurn = turnRate * (elapsedMs / 1000);
    const rotated = angle <= maxTurn ? desired : rotateToward(committed, desired, maxTurn);
    // When the hold expires while the bot is still turning, start a fresh hold
    // and keep rotating instead of snapping. This is what removes the visible
    // left/right shaking around loot, crates, doors and cover.
    const nextLock = options.timestamp >= options.lockUntil
        ? options.timestamp + holdMs
        : options.lockUntil;
    return { direction: rotated, lockUntil: nextLock };
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const angleBetween = (
    a: { x: number; y: number },
    b: { x: number; y: number },
): number => {
    const dot = clamp(a.x * b.x + a.y * b.y, -1, 1);
    return Math.acos(dot);
};

const rotateToward = (
    current: { x: number; y: number },
    target: { x: number; y: number },
    maxRadians: number,
): { x: number; y: number } => {
    const currentAngle = Math.atan2(current.y, current.x);
    const targetAngle = Math.atan2(target.y, target.x);
    let delta = targetAngle - currentAngle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const nextAngle = currentAngle + Math.sign(delta) * Math.min(Math.abs(delta), maxRadians);
    return { x: Math.cos(nextAngle), y: Math.sin(nextAngle) };
};
