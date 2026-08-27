export interface Direction2D {
    x: number;
    y: number;
}

const TAU = Math.PI * 2;

export function normalizeDirection(
    value: Direction2D,
    fallback: Direction2D = { x: 1, y: 0 },
): Direction2D {
    const x = Number(value?.x);
    const y = Number(value?.y);
    const length = Math.hypot(x, y);
    if (!Number.isFinite(length) || length <= 1e-6) {
        const fallbackLength = Math.hypot(Number(fallback.x), Number(fallback.y));
        if (!Number.isFinite(fallbackLength) || fallbackLength <= 1e-6) {
            return { x: 1, y: 0 };
        }
        return { x: fallback.x / fallbackLength, y: fallback.y / fallbackLength };
    }
    return { x: x / length, y: y / length };
}

export function shortestAngleDelta(fromRadians: number, toRadians: number): number {
    let delta = (toRadians - fromRadians) % TAU;
    if (delta > Math.PI) delta -= TAU;
    if (delta < -Math.PI) delta += TAU;
    return delta;
}

export function angularDistance(a: Direction2D, b: Direction2D): number {
    const current = normalizeDirection(a);
    const target = normalizeDirection(b, current);
    const dot = Math.max(-1, Math.min(1, current.x * target.x + current.y * target.y));
    return Math.acos(dot);
}

/**
 * Rotate toward a desired aim direction with a hard angular-speed limit.
 * The time step is capped so a delayed event-loop tick can never produce an
 * instant 180-degree snap.
 */
export function rotateDirectionTowards(
    currentValue: Direction2D,
    targetValue: Direction2D,
    radiansPerSecond: number,
    elapsedMs: number,
): Direction2D {
    const current = normalizeDirection(currentValue);
    const target = normalizeDirection(targetValue, current);
    const currentAngle = Math.atan2(current.y, current.x);
    const targetAngle = Math.atan2(target.y, target.x);
    const delta = shortestAngleDelta(currentAngle, targetAngle);
    const safeRate = Math.max(0.05, Number(radiansPerSecond) || 0.05);
    const safeElapsedSeconds = Math.max(0.001, Math.min(0.1, Number(elapsedMs) / 1000 || 0.001));
    const maxStep = safeRate * safeElapsedSeconds;
    if (Math.abs(delta) <= maxStep) return target;
    const nextAngle = currentAngle + Math.sign(delta) * maxStep;
    return { x: Math.cos(nextAngle), y: Math.sin(nextAngle) };
}
export function predictTrackedAimDirection(
    origin: Direction2D,
    targetPosition: Direction2D,
    targetVelocity: Direction2D,
    leadSeconds: number,
    fallback: Direction2D = { x: 1, y: 0 },
): Direction2D {
    const safeLead = Math.max(0, Math.min(0.25, Number(leadSeconds) || 0));
    return normalizeDirection(
        {
            x: Number(targetPosition.x) + Number(targetVelocity.x) * safeLead - Number(origin.x),
            y: Number(targetPosition.y) + Number(targetVelocity.y) * safeLead - Number(origin.y),
        },
        fallback,
    );
}

export function shouldDelayGunfire(
    remainingAimErrorRadians: number,
    automatic: boolean,
    precisionWeapon = false,
    alignmentWaitMs = 0,
    exactGeometry = false,
): boolean {
    // A nine-degree allowance is acceptable for close automatic fire but is a
    // complete miss at sniper ranges. Precision rifles wait until the smoothed
    // server-facing direction is within roughly 0.7 degrees.
    const alignmentLimit = precisionWeapon ? 0.012 : automatic ? 0.25 : 0.16;
    const remainingError = Number(remainingAimErrorRadians);
    if (!Number.isFinite(remainingError)) return true;
    // A ricochet angle selects both a contact point and its surface normal, so
    // keep it far tighter than ordinary gunfire. Authoritative barrel-physics
    // simulation shows that 0.001 rad already begins losing >10% in some weapon/
    // movement cases. Keep V257's accurate 0.0006-rad initial gate, but add only
    // a tiny bounded recovery to 0.0009 rad after a sustained request so tracking
    // jitter cannot suppress a mathematically valid shot forever.
    if (exactGeometry) {
        if (remainingError <= 0.0006) return false;
        return !(
            Math.max(0, Number(alignmentWaitMs) || 0) >= 140
            && remainingError <= 0.0009
        );
    }
    if (remainingError <= alignmentLimit) return false;

    // A moving prediction point and the deliberately held aim jitter can keep
    // the desired bearing a fraction ahead of the transmitted bearing forever.
    // Keep the strict limit for the initial turn, but after a short continuous
    // firing request accept a still-safe error instead of permanently eating
    // every shot at the packet boundary.
    const recoveryDelayMs = precisionWeapon ? 280 : automatic ? 180 : 220;
    const recoveryLimit = precisionWeapon ? 0.055 : automatic ? 0.3 : 0.2;
    return !(
        Math.max(0, Number(alignmentWaitMs) || 0) >= recoveryDelayMs
        && remainingError <= recoveryLimit
    );
}

/**
 * Object and local-data updates are separate packets. Near the end of a reload
 * the clip can already be authoritative and full while the player's Reload
 * action lingers for one object-update frame. A full gun must not remain
 * fire-locked by that stale action flag.
 */
export function reloadStateBlocksGunfire(
    reloadActionActive: boolean,
    clipAmmo: number,
    maxClip: number,
): boolean {
    if (!reloadActionActive) return false;
    const ammo = Number(clipAmmo);
    const capacity = Number(maxClip);
    if (
        Number.isFinite(ammo)
        && Number.isFinite(capacity)
        && capacity > 0
        && ammo >= capacity
    ) {
        return false;
    }
    return true;
}
