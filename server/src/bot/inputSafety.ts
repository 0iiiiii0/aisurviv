import { Constants } from "../../../shared/net/net.ts";

/**
 * InputMsg serializes toMouseLen as a float in [0, MouseMaxDist].
 * Keep this guard at the packet boundary even when callers already clamp.
 */
export function sanitizeMouseDistance(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(Constants.MouseMaxDist, numeric));
}

export type ThrowableEquipCommand = "ready" | "input" | "wait";

/**
 * EquipThrowable is a dual-purpose input: outside slot 3 it equips the
 * current throwable, while inside slot 3 it cycles to the next throwable.
 * Suppress duplicate packets until the authoritative slot/type changes,
 * otherwise a delayed acknowledgement turns "equip MIRV" into "cycle to
 * smoke" and the bot can loop forever without throwing.
 */
export function planThrowableEquipStep(input: {
    currentSlot: number;
    throwableSlot: number;
    currentType: string;
    desiredType: string;
    timestamp: number;
    requestedAt?: number;
    requestedFromSlot?: number;
    requestedFromType?: string;
    retryMs?: number;
}): { command: ThrowableEquipCommand; reason: string } {
    if (
        input.currentSlot === input.throwableSlot
        && input.currentType === input.desiredType
    ) {
        return { command: "ready", reason: "equipped" };
    }

    const awaitingSameTransition = input.requestedAt !== undefined
        && input.requestedFromSlot === input.currentSlot
        && input.requestedFromType === input.currentType
        && input.timestamp - input.requestedAt < Math.max(250, input.retryMs ?? 900);
    if (awaitingSameTransition) {
        return { command: "wait", reason: "await-authoritative-change" };
    }

    return {
        command: "input",
        reason: input.currentSlot === input.throwableSlot
            ? "cycle-type"
            : "equip-slot",
    };
}

export type ThrowableInputPhase = undefined | "holding" | "released";

export function advanceThrowableInput(input: {
    phase: ThrowableInputPhase;
    timestamp: number;
    releaseAt?: number;
    cookMs: number;
}): {
    phase: Exclude<ThrowableInputPhase, undefined>;
    releaseAt: number;
    shootStart: boolean;
    shootHold: boolean;
    releasedNow: boolean;
} {
    // The server rejects a throwable release before GameConfig.player.cookTime
    // (100 ms). Keep every bot input above that authoritative floor; rapid
    // counter-strobe sequences are paced by the normal 300 ms throw cooldown.
    const cookMs = Math.max(100, Math.min(3300, Math.round(input.cookMs)));
    if (!input.phase) {
        return {
            phase: "holding",
            releaseAt: input.timestamp + cookMs,
            shootStart: true,
            shootHold: true,
            releasedNow: false,
        };
    }
    if (input.phase === "holding" && input.timestamp < (input.releaseAt ?? input.timestamp)) {
        return {
            phase: "holding",
            releaseAt: input.releaseAt ?? input.timestamp,
            shootStart: false,
            shootHold: true,
            releasedNow: false,
        };
    }
    return {
        phase: "released",
        releaseAt: input.releaseAt ?? input.timestamp,
        shootStart: false,
        shootHold: false,
        releasedNow: input.phase === "holding",
    };
}
