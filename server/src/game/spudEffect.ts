export interface SpudEffectState {
    scaleBonus: number;
    decayDelay: number;
    speedPenaltyPerScale: number;
}

export interface SpudHitConfig {
    scalePerHit: number;
    maxScaleBonus: number;
    decayDelay: number;
    speedPenaltyPerScale: number;
}

export const EMPTY_SPUD_EFFECT: Readonly<SpudEffectState> = {
    scaleBonus: 0,
    decayDelay: 0,
    speedPenaltyPerScale: 0,
};

export function applySpudHit(
    state: SpudEffectState,
    config: SpudHitConfig,
    immune: boolean,
): SpudEffectState {
    if (immune) return { ...state };
    return {
        scaleBonus: Math.min(
            Math.max(0, config.maxScaleBonus),
            Math.max(0, state.scaleBonus) + Math.max(0, config.scalePerHit),
        ),
        decayDelay: Math.max(state.decayDelay, Math.max(0, config.decayDelay)),
        speedPenaltyPerScale: Math.max(
            state.speedPenaltyPerScale,
            Math.max(0, config.speedPenaltyPerScale),
        ),
    };
}

/**
 * The enlargement pauses briefly after the latest hit, then wears off smoothly
 * instead of snapping the player's collider back to normal in one frame.
 */
export function advanceSpudEffect(
    state: SpudEffectState,
    dt: number,
    decayPerSecond: number,
): SpudEffectState {
    const elapsed = Math.max(0, dt);
    if (state.scaleBonus <= 0) return { ...EMPTY_SPUD_EFFECT };
    if (state.decayDelay > 0) {
        return {
            ...state,
            decayDelay: Math.max(0, state.decayDelay - elapsed),
        };
    }
    const nextBonus = Math.max(
        0,
        state.scaleBonus - Math.max(0, decayPerSecond) * elapsed,
    );
    return nextBonus <= 0
        ? { ...EMPTY_SPUD_EFFECT }
        : { ...state, scaleBonus: nextBonus };
}
