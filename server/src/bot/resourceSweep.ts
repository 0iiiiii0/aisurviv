import type { Vec2 } from "../../../shared/utils/v2.ts";
import type { MapPhase } from "./mapStrategy.ts";

export interface OpeningResourceSweep {
    center: Vec2 | null;
    startedAt: number;
    expiresAt: number;
    radius: number;
}

export const OPENING_RESOURCE_SWEEP_MAX_MS = 26000;
const OPENING_RESOURCE_SWEEP_REFRESH_MS = 7500;

export function emptyOpeningResourceSweep(): OpeningResourceSweep {
    return {
        center: null,
        startedAt: 0,
        expiresAt: 0,
        radius: 0,
    };
}

export function openingResourceSweepActive(
    sweep: OpeningResourceSweep,
    phase: MapPhase,
    timestamp: number,
): boolean {
    return Boolean(
        phase === "early"
            && sweep.center
            && sweep.startedAt > 0
            && timestamp < sweep.expiresAt
            && timestamp - sweep.startedAt < OPENING_RESOURCE_SWEEP_MAX_MS,
    );
}

export function openingResourceSweepContains(
    sweep: OpeningResourceSweep,
    pos: Vec2,
    phase: MapPhase,
    timestamp: number,
): boolean {
    if (!openingResourceSweepActive(sweep, phase, timestamp) || !sweep.center) return false;
    return Math.hypot(pos.x - sweep.center.x, pos.y - sweep.center.y) <= sweep.radius;
}

export function openingResourceSweepScoreBonus(
    sweep: OpeningResourceSweep,
    pos: Vec2,
    phase: MapPhase,
    timestamp: number,
): number {
    if (!openingResourceSweepActive(sweep, phase, timestamp) || !sweep.center) return 0;
    const dist = Math.hypot(pos.x - sweep.center.x, pos.y - sweep.center.y);
    if (dist <= sweep.radius) return 210 + Math.max(0, sweep.radius - dist) * 3.5;
    return -180 - Math.max(0, dist - sweep.radius) * 1.5;
}

export function beginOrExtendOpeningResourceSweep(
    sweep: OpeningResourceSweep,
    target: Vec2,
    sourceValue: number,
    phase: MapPhase,
    timestamp: number,
): OpeningResourceSweep {
    if (phase !== "early") return emptyOpeningResourceSweep();

    const requestedRadius = Math.max(20, Math.min(30, 20 + sourceValue * 0.075));
    if (
        openingResourceSweepActive(sweep, phase, timestamp)
        && sweep.center
        && Math.hypot(target.x - sweep.center.x, target.y - sweep.center.y) <= sweep.radius + 8
    ) {
        const hardExpiry = sweep.startedAt + OPENING_RESOURCE_SWEEP_MAX_MS;
        return {
            center: {
                x: sweep.center.x * 0.82 + target.x * 0.18,
                y: sweep.center.y * 0.82 + target.y * 0.18,
            },
            startedAt: sweep.startedAt,
            expiresAt: Math.min(hardExpiry, Math.max(sweep.expiresAt, timestamp + OPENING_RESOURCE_SWEEP_REFRESH_MS)),
            radius: Math.max(sweep.radius, requestedRadius),
        };
    }

    return {
        center: { x: target.x, y: target.y },
        startedAt: timestamp,
        expiresAt: timestamp + OPENING_RESOURCE_SWEEP_MAX_MS,
        radius: requestedRadius,
    };
}
