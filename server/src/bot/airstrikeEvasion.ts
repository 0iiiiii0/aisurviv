export interface Point2 {
    x: number;
    y: number;
}

export interface AirstrikeZoneState {
    pos: Point2;
    rad: number;
    highDamageRad: number;
    impactInMs: number;
    expiresAt: number;
    /** Timestamp at which impactInMs was last authoritative/refreshed. */
    updatedAt?: number;
}

export interface AirstrikeThreatAssessment extends AirstrikeZoneState {
    distance: number;
    edge: number;
    coreEdge: number;
    inside: boolean;
    insideHighDamage: boolean;
    imminent: boolean;
    highestPriority: boolean;
    score: number;
}

export interface EscapeCandidateInput {
    origin: Point2;
    zone: AirstrikeThreatAssessment;
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
    pathClear?: (from: Point2, to: Point2) => boolean;
    isOutsideGas?: (point: Point2) => boolean;
    /** Residual risk from every other overlapping warning at this point. */
    airstrikeRisk?: (point: Point2) => number;
    playerSeed?: number;
}

export interface EscapeCandidateResult {
    target: Point2;
    direction: Point2;
    score: number;
    clear: boolean;
}

export interface EncodedAirstrikeTiming {
    impactInMs: number;
    highDamageRad: number;
}

/**
 * The public client protocol intentionally remains compatible with the existing
 * three-field airstrike packet. Server bots infer the first-impact countdown
 * from the warning's remaining lifetime and radius:
 * - normal strobe: impact + 3.65 s tail (three passes over three seconds)
 * - Broken Arrow: impact + 4.05 s tail (five passes over three seconds)
 * - map/plane single strike: impact + 2.8 s tail
 */
export function inferEncodedAirstrikeTiming(
    rad: number,
    durationSeconds: number,
): EncodedAirstrikeTiming {
    const safeRad = Math.max(1, Number(rad) || 1);
    const duration = Math.max(0, Number(durationSeconds) || 0);
    const tailSeconds = safeRad >= 30
        ? 4.05
        : safeRad >= 17.5
        ? 2.8
        : safeRad >= 16
        ? 3.65
        : 3.25;
    return {
        impactInMs: Math.max(0, duration - tailSeconds) * 1000,
        highDamageRad: Math.max(1, Math.min(safeRad, safeRad * 0.68)),
    };
}

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
const rotate = (a: Point2, angle: number): Point2 => ({
    x: a.x * Math.cos(angle) - a.y * Math.sin(angle),
    y: a.x * Math.sin(angle) + a.y * Math.cos(angle),
});

export function remainingAirstrikeImpactMs(
    zone: AirstrikeZoneState,
    timestamp: number,
): number {
    const updatedAt = Number(zone.updatedAt ?? timestamp);
    return Math.max(0, Number(zone.impactInMs) - Math.max(0, timestamp - updatedAt));
}

/**
 * Bot updates can briefly lose a strobe warning after the projectile vanishes
 * and before the first plane/bomb has been serialized. Retain unmatched live
 * zones until their authoritative expiry instead of treating that hand-off gap
 * as instant safety.
 */
export function mergeAirstrikeZoneUpdates(
    previous: readonly AirstrikeZoneState[],
    incoming: readonly AirstrikeZoneState[],
    timestamp: number,
): AirstrikeZoneState[] {
    const old = previous
        .filter((zone) => zone.expiresAt > timestamp)
        .map((zone) => ({
            ...zone,
            impactInMs: remainingAirstrikeImpactMs(zone, timestamp),
            updatedAt: timestamp,
        }));
    const used = new Set<number>();
    const merged: AirstrikeZoneState[] = [];

    for (const next of incoming) {
        let match = -1;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let i = 0; i < old.length; i += 1) {
            if (used.has(i)) continue;
            const candidate = old[i];
            const maxMatchDistance = Math.max(4, Math.min(candidate.rad, next.rad) * 0.55);
            const d = distance(candidate.pos, next.pos);
            if (d <= maxMatchDistance && d < bestDistance) {
                bestDistance = d;
                match = i;
            }
        }
        if (match >= 0) used.add(match);
        merged.push({
            ...next,
            updatedAt: timestamp,
            // Never shorten a still-live warning merely because the source
            // changed from projectile prediction to plane/bomb serialization.
            expiresAt: Math.max(next.expiresAt, match >= 0 ? old[match].expiresAt : 0),
        });
    }

    for (let i = 0; i < old.length; i += 1) {
        if (!used.has(i)) merged.push(old[i]);
    }

    // Collapse near-identical warnings produced by the strobe/plane hand-off.
    const deduped: AirstrikeZoneState[] = [];
    for (const zone of merged.sort((a, b) => b.rad - a.rad)) {
        const duplicate = deduped.find(
            (candidate) =>
                distance(candidate.pos, zone.pos) <= Math.max(3, Math.min(candidate.rad, zone.rad) * 0.35)
                && Math.abs(candidate.expiresAt - zone.expiresAt) <= 2600,
        );
        if (!duplicate) {
            deduped.push(zone);
            continue;
        }
        duplicate.rad = Math.max(duplicate.rad, zone.rad);
        duplicate.highDamageRad = Math.max(duplicate.highDamageRad, zone.highDamageRad);
        duplicate.impactInMs = Math.min(duplicate.impactInMs, zone.impactInMs);
        duplicate.expiresAt = Math.max(duplicate.expiresAt, zone.expiresAt);
    }
    return deduped;
}

export function airstrikePointRisk(
    point: Point2,
    zones: readonly AirstrikeZoneState[],
    timestamp: number,
): number {
    let risk = 0;
    for (const zone of zones) {
        if (zone.expiresAt <= timestamp) continue;
        const d = distance(point, zone.pos);
        const impact = remainingAirstrikeImpactMs(zone, timestamp);
        const fullEdge = d - zone.rad;
        const coreEdge = d - Math.max(1, zone.highDamageRad);
        if (coreEdge <= 0) risk += 180000 + Math.max(0, 6000 - impact) * 20;
        else if (fullEdge <= 0) risk += 70000 + Math.max(0, 5000 - impact) * 10;
        else risk += Math.max(0, 14 - fullEdge) * 2600;
    }
    return risk;
}

/**
 * Converts an authoritative warning into a priority decision. The core rule is
 * intentionally strict: when the first bombs are close and the bot is inside
 * the high-damage core, evacuation outranks gas rotation, combat, healing and
 * all resource interactions.
 */
export function assessAirstrikeThreat(
    point: Point2,
    zones: readonly AirstrikeZoneState[],
    timestamp: number,
): AirstrikeThreatAssessment | null {
    let best: AirstrikeThreatAssessment | null = null;
    for (const zone of zones) {
        if (zone.expiresAt <= timestamp) continue;
        const dist = distance(point, zone.pos);
        const rad = Math.max(1, zone.rad);
        const highDamageRad = clamp(zone.highDamageRad || rad * 0.68, 1, rad);
        const edge = dist - rad;
        const coreEdge = dist - highDamageRad;
        const inside = edge <= 0;
        const insideHighDamage = coreEdge <= 0;
        const impactInMs = remainingAirstrikeImpactMs(zone, timestamp);
        const imminent = impactInMs <= 5200;
        const highestPriority = (insideHighDamage && impactInMs <= 5600)
            || (inside && impactInMs <= 3600);
        // A bot already outside the strike footprint must not abandon combat
        // just because impact is imminent. Keep only a small uncertainty
        // margin around the edge; it grows for distant impacts because the
        // warning center and the bot's future position are less certain.
        const outsidePredictionMargin = clamp(
            2.5 + impactInMs / 1400,
            2.5,
            6.5,
        );
        const reachableWarning = edge <= outsidePredictionMargin;
        if (!inside && !reachableWarning) continue;
        const score = (highestPriority ? 100000 : 0)
            + (insideHighDamage ? 22000 : inside ? 9000 : 1800)
            + Math.max(0, 6500 - impactInMs) * 1.35
            - edge * 90;
        const assessment: AirstrikeThreatAssessment = {
            ...zone,
            distance: dist,
            edge,
            coreEdge,
            inside,
            insideHighDamage,
            imminent,
            highestPriority,
            score,
        };
        if (!best || assessment.score > best.score) best = assessment;
    }
    return best;
}

/**
 * Selects a reachable point outside the complete strike footprint. Multiple
 * angular candidates prevent a bot from repeatedly pushing into one wall or
 * building shell along the mathematically shortest radial line.
 */
export function selectAirstrikeEscapeTarget(
    input: EscapeCandidateInput,
): EscapeCandidateResult {
    const { origin, zone, bounds } = input;
    const fallbackAngle = ((input.playerSeed ?? 0) % 16) * (Math.PI / 8);
    const outward = normalize(sub(origin, zone.pos), {
        x: Math.cos(fallbackAngle),
        y: Math.sin(fallbackAngle),
    });
    const angles = [
        0,
        Math.PI / 9,
        -Math.PI / 9,
        Math.PI / 4,
        -Math.PI / 4,
        Math.PI / 2,
        -Math.PI / 2,
        (2 * Math.PI) / 3,
        (-2 * Math.PI) / 3,
        Math.PI,
    ];
    const margin = zone.highestPriority ? 27 : 18;
    const baseTargetRadius = Math.max(zone.rad + margin, zone.distance + 12);
    const ringOffsets = [0, 10, 20];
    let best: EscapeCandidateResult | null = null;
    for (const ringOffset of ringOffsets) {
        const targetRadius = baseTargetRadius + ringOffset;
        for (let i = 0; i < angles.length; i += 1) {
            const direction = rotate(outward, angles[i]);
            const raw = add(zone.pos, mul(direction, targetRadius));
            const target = {
                x: clamp(raw.x, bounds.minX, bounds.maxX),
                y: clamp(raw.y, bounds.minY, bounds.maxY),
            };
            const targetDistance = distance(target, zone.pos);
            const clear = input.pathClear ? input.pathClear(origin, target) : true;
            const gasPenalty = input.isOutsideGas?.(target) ? (zone.highestPriority ? 90 : 950) : 0;
            const residualDanger = Math.max(0, zone.rad + 12 - targetDistance);
            const overlapPenalty = Math.max(0, input.airstrikeRisk?.(target) ?? 0);
            const angularPenalty = Math.abs(angles[i]) * 4.5;
            const routePenalty = distance(origin, target) * 0.42;
            const score = residualDanger * 15000
                + overlapPenalty
                + (clear ? 0 : zone.highestPriority ? 180 : 1800)
                + gasPenalty
                + routePenalty
                + angularPenalty
                + ringOffset * 0.8;
            const candidate = { target, direction, score, clear };
            if (!best || candidate.score < best.score) best = candidate;
        }
    }
    return best ?? {
        target: add(origin, mul(outward, 10)),
        direction: outward,
        score: Number.POSITIVE_INFINITY,
        clear: false,
    };
}
