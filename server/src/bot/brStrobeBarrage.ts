/**
 * Battle-royale strobe (airstrike beacon) barrage planning for AI.
 *
 * Balance goal: a human carrying many beacons must not be able to carpet-bomb
 * the whole lobby for free. AI on the other hand should answer back with the
 * same weapon when it has a large beacon stock, and counter immediately when
 * it is being bombed. The server additionally throttles HUMAN beacon call-ins
 * (see projectile.ts strobeStrikeLockedUntil), so this module only decides the
 * AI side. Duels use the same rules: with enough beacons the AI opens the
 * round with an immediate barrage instead of waiting to be bombed first.
 */

export interface BrStrobeBarrageInput {
    /** Total strobes the bot can throw (inventory + equipped throwable). */
    strobeCount: number;
    /** Live hostile airstrike zones the bot can observe right now. */
    hostilePressure: number;
    enemyDistance: number;
    enemyVisible: boolean;
    millisecondsSinceDamage: number;
    reloadingOrHealing: boolean;
}

export interface BrStrobeBarragePlan {
    /** Beacons committed to this barrage. */
    barrageCount: number;
    /** Beacons kept in reserve after the barrage. */
    reserveCount: number;
    /** True when this is a counter-barrage (reply to hostile bombing). */
    counter: boolean;
    /** Milliseconds between consecutive throws during the barrage. */
    rateMs: number;
}

export function planBrStrobeBarrage(
    input: BrStrobeBarrageInput,
): BrStrobeBarragePlan | null {
    const available = Math.max(0, Math.floor(input.strobeCount));
    if (available <= 0) return null;
    if (!input.enemyVisible) return null;
    // The strobe throw envelope is roughly 14-40 units (see solveForbiddenStrobeThrow).
    if (input.enemyDistance < 14 || input.enemyDistance > 40) return null;
    if (input.reloadingOrHealing) return null;
    // Never start a barrage while still recovering from recent damage.
    if (input.millisecondsSinceDamage < 400) return null;

    const pressure = Math.min(6, Math.max(0, Math.floor(input.hostilePressure)));
    let barrageCount = 0;
    let counter = false;
    if (pressure >= 2) {
        // Being carpet-bombed: answer back immediately with up to three beacons.
        barrageCount = Math.min(3, available);
        counter = true;
    } else if (available >= 3) {
        // Large beacon stock: proactive quick carpet bombardment.
        barrageCount = Math.min(5, available);
    }
    if (barrageCount <= 0) return null;

    return {
        barrageCount,
        reserveCount: Math.max(0, available - barrageCount),
        counter,
        rateMs: counter ? 360 : 420,
    };
}
