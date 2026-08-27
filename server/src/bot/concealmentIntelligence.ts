/*
 * Concealment and hidden-contact tactics for the surviv.io bot.
 *
 * The tracker deliberately stores only the last visually confirmed enemy
 * position and velocity. Once an enemy disappears under a roof, into a bush,
 * or into smoke, the predicted point is constrained to that concealment zone;
 * hidden network coordinates are never used for blind-fire aiming.
 */

export interface ConcealmentVec2 {
    x: number;
    y: number;
}

export type ConcealmentKind = "bush" | "roof" | "smoke";

export interface ConcealmentRegion {
    min: ConcealmentVec2;
    max: ConcealmentVec2;
}

export interface ConcealmentZone {
    key: string;
    kind: ConcealmentKind;
    center: ConcealmentVec2;
    radius: number;
    layer: number;
    objectId: number;
    buildingId: number;
    destructible: boolean;
    healthT: number;
    ceilingDead: boolean;
    ceilingDamaged: boolean;
    occupied: boolean;
    supportIds: number[];
    /** Exact world-space roof/floor regions when the map definition provides them. */
    regions?: ConcealmentRegion[];
}

export interface EnemyVisibilityObservation {
    enemyId: number;
    visible: boolean;
    pos?: ConcealmentVec2;
    velocity?: ConcealmentVec2;
    layer: number;
}

export interface HiddenContact {
    enemyId: number;
    zoneKey: string;
    kind: ConcealmentKind;
    entryPos: ConcealmentVec2;
    estimatedPos: ConcealmentVec2;
    lastVisibleVelocity: ConcealmentVec2;
    confidence: number;
    hiddenAt: number;
    updatedAt: number;
    expiresAt: number;
    sweepSeed: number;
}

export interface HideContext {
    health: number;
    recentlyDamaged: boolean;
    enemyPos: ConcealmentVec2 | null;
    circleCenter: ConcealmentVec2 | null;
    circleRadius: number | null;
    teammateCountAt: (point: ConcealmentVec2, radius: number) => number;
    dangerousAt: (point: ConcealmentVec2, radius: number) => boolean;
}

export interface HideChoice {
    zone: ConcealmentZone;
    hidePoint: ConcealmentVec2;
    score: number;
}

interface VisibleTrack {
    pos: ConcealmentVec2;
    velocity: ConcealmentVec2;
    lastVisibleAt: number;
    wasVisible: boolean;
    layer: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const sqr = (value: number): number => value * value;
const lengthSq = (value: ConcealmentVec2): number => sqr(value.x) + sqr(value.y);
const length = (value: ConcealmentVec2): number => Math.sqrt(lengthSq(value));
const add = (a: ConcealmentVec2, b: ConcealmentVec2): ConcealmentVec2 => ({
    x: a.x + b.x,
    y: a.y + b.y,
});
const sub = (a: ConcealmentVec2, b: ConcealmentVec2): ConcealmentVec2 => ({
    x: a.x - b.x,
    y: a.y - b.y,
});
const mul = (value: ConcealmentVec2, scalar: number): ConcealmentVec2 => ({
    x: value.x * scalar,
    y: value.y * scalar,
});
const distance = (a: ConcealmentVec2, b: ConcealmentVec2): number => length(sub(a, b));
const normalize = (
    value: ConcealmentVec2,
    fallback: ConcealmentVec2 = { x: 1, y: 0 },
): ConcealmentVec2 => {
    const len = length(value);
    return len > 0.0001 ? mul(value, 1 / len) : fallback;
};

export interface ConcealmentStandoffContext {
    botPos: ConcealmentVec2;
    zone: ConcealmentZone;
    mapWidth: number;
    mapHeight: number;
    circleCenter?: ConcealmentVec2 | null;
    circleRadius?: number | null;
    preferredDirection?: ConcealmentVec2 | null;
    /** Minimum distance beyond the mandatory one-view safety ring. */
    minimumRingOffset?: number;
    /** Maximum distance beyond the mandatory one-view safety ring. */
    maximumRingOffset?: number;
    dangerousAt?: (point: ConcealmentVec2, radius: number) => boolean;
    reachableAt?: (point: ConcealmentVec2) => boolean;
}

export interface ConcealmentStandoffChoice {
    point: ConcealmentVec2;
    minimumCenterDistance: number;
    edgeDistance: number;
    score: number;
}

/** Baseline radial distance represented by the normal 1x camera. */
export const ONE_X_VISION_DISTANCE = 28;
export const CONCEALMENT_STANDOFF_BUFFER = 2.75;

export function concealmentEdgeDistance(
    point: ConcealmentVec2,
    zone: ConcealmentZone,
): number {
    return distance(point, zone.center) - zone.radius;
}

export function concealmentMinimumStandoffDistance(
    zone: ConcealmentZone,
    visionDistance = ONE_X_VISION_DISTANCE,
    buffer = CONCEALMENT_STANDOFF_BUFFER,
): number {
    return Math.max(zone.radius + visionDistance + buffer, zone.radius + 8);
}

export function outsideConcealmentOneXVision(
    point: ConcealmentVec2,
    zone: ConcealmentZone,
    visionDistance = ONE_X_VISION_DISTANCE,
    buffer = CONCEALMENT_STANDOFF_BUFFER,
): boolean {
    return distance(point, zone.center)
        >= concealmentMinimumStandoffDistance(zone, visionDistance, buffer);
}

/**
 * Selects a point on a safe ring outside a hidden player's normal 1x view.
 * The function is pure and deliberately knows nothing about hidden live
 * coordinates; it only uses the concealment zone and the bot's current side.
 */
export function chooseConcealmentStandoffPoint(
    context: ConcealmentStandoffContext,
): ConcealmentStandoffChoice | null {
    const { botPos, zone } = context;
    const minimumCenterDistance = concealmentMinimumStandoffDistance(zone);
    const currentOffset = sub(botPos, zone.center);
    const currentDirection = normalize(currentOffset, { x: 1, y: 0 });
    const preferred = normalize(
        context.preferredDirection ?? currentDirection,
        currentDirection,
    );
    const currentDistance = distance(botPos, zone.center);
    const minimumRingOffset = clamp(context.minimumRingOffset ?? 1.5, 0.75, 8);
    const maximumRingOffset = clamp(
        Math.max(minimumRingOffset, context.maximumRingOffset ?? 7),
        minimumRingOffset,
        12,
    );
    const ringDistance = Math.max(
        minimumCenterDistance + minimumRingOffset,
        Math.min(minimumCenterDistance + maximumRingOffset, currentDistance),
    );
    const margin = 2.25;
    const candidates: ConcealmentVec2[] = [];

    // Keep the current side first, then fan out around the ring. This avoids
    // circling around a toilet/container entrance and entering the ambusher's
    // short-range unilateral view cone.
    for (const offset of [0, 0.32, -0.32, 0.65, -0.65, 1.05, -1.05, 1.5, -1.5]) {
        const angle = Math.atan2(preferred.y, preferred.x) + offset;
        candidates.push({
            x: zone.center.x + Math.cos(angle) * ringDistance,
            y: zone.center.y + Math.sin(angle) * ringDistance,
        });
    }

    let best: ConcealmentStandoffChoice | null = null;
    for (const raw of candidates) {
        const point = {
            x: clamp(raw.x, margin, Math.max(margin, context.mapWidth - margin)),
            y: clamp(raw.y, margin, Math.max(margin, context.mapHeight - margin)),
        };
        const centerDistance = distance(point, zone.center);
        if (centerDistance < minimumCenterDistance - 0.25) continue;
        if (context.dangerousAt?.(point, 2.5)) continue;
        if (context.reachableAt && !context.reachableAt(point)) continue;

        let score = 120;
        score -= distance(botPos, point) * 1.05;
        score += (preferred.x * normalize(sub(point, zone.center)).x
            + preferred.y * normalize(sub(point, zone.center)).y) * 18;
        score -= Math.abs(centerDistance - ringDistance) * 2;

        if (context.circleCenter && context.circleRadius !== null && context.circleRadius !== undefined) {
            const gasMargin = Math.max(1.5, zone.radius * 0.08);
            const inside = distance(point, context.circleCenter)
                <= Math.max(0, context.circleRadius - gasMargin);
            score += inside ? 30 : -220;
        }

        const choice: ConcealmentStandoffChoice = {
            point,
            minimumCenterDistance,
            edgeDistance: centerDistance - zone.radius,
            score,
        };
        if (!best || choice.score > best.score) best = choice;
    }
    return best;
}

const pointInsideRegion = (
    point: ConcealmentVec2,
    region: ConcealmentRegion,
    margin: number,
): boolean => {
    const minX = region.min.x - margin;
    const minY = region.min.y - margin;
    const maxX = region.max.x + margin;
    const maxY = region.max.y + margin;
    if (minX <= maxX && minY <= maxY) {
        return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
    }
    // Excessive negative margins can invert a narrow surface. Preserve a
    // small valid center instead of making the whole room disappear.
    const centerX = (region.min.x + region.max.x) * 0.5;
    const centerY = (region.min.y + region.max.y) * 0.5;
    return Math.abs(point.x - centerX) <= 0.25 && Math.abs(point.y - centerY) <= 0.25;
};

const pointRegionGap = (point: ConcealmentVec2, region: ConcealmentRegion): number => {
    const dx = Math.max(region.min.x - point.x, 0, point.x - region.max.x);
    const dy = Math.max(region.min.y - point.y, 0, point.y - region.max.y);
    return Math.hypot(dx, dy);
};

export function pointInsideConcealment(
    point: ConcealmentVec2,
    zone: ConcealmentZone,
    margin = 0,
): boolean {
    if (zone.regions?.length) {
        return zone.regions.some((region) => pointInsideRegion(point, region, margin));
    }
    return distance(point, zone.center) <= Math.max(0.5, zone.radius + margin);
}

function pointToSegmentDistance(
    point: ConcealmentVec2,
    start: ConcealmentVec2,
    end: ConcealmentVec2,
): number {
    const segment = sub(end, start);
    const denominator = lengthSq(segment);
    if (denominator <= 0.0001) return distance(point, start);
    const projection = sub(point, start);
    const t = clamp(
        (projection.x * segment.x + projection.y * segment.y) / denominator,
        0,
        1,
    );
    return distance(point, add(start, mul(segment, t)));
}

/** Whether a concealment zone hides the exact target position from an observer. */
export function concealmentBlocksVisualContact(
    observer: ConcealmentVec2,
    target: ConcealmentVec2,
    zone: ConcealmentZone,
): boolean {
    if (zone.ceilingDead) return false;
    if (!pointInsideConcealment(target, zone, zone.kind === "roof" ? -0.35 : -0.1)) {
        if (zone.kind !== "smoke") return false;
    }
    const observerInside = pointInsideConcealment(
        observer,
        zone,
        zone.kind === "roof" ? -0.2 : -0.55,
    );
    if (zone.kind === "roof") return !observerInside;
    if (zone.kind === "bush") {
        return !observerInside && distance(observer, target) > 3.8;
    }
    return (
        !observerInside
        && distance(observer, target) > 3.8
        && pointToSegmentDistance(zone.center, observer, target)
            <= Math.max(0.5, zone.radius * 0.92)
    );
}

export function nearestConcealmentZone(
    point: ConcealmentVec2,
    layer: number,
    zones: ConcealmentZone[],
    maxOutsideDistance = 4,
): ConcealmentZone | null {
    let best: ConcealmentZone | null = null;
    let bestGap = Infinity;
    for (const zone of zones) {
        if (zone.layer !== layer || zone.ceilingDead) continue;
        const gap = zone.regions?.length
            ? Math.min(...zone.regions.map((region) => pointRegionGap(point, region)))
            : Math.max(0, distance(point, zone.center) - zone.radius);
        if (gap <= maxOutsideDistance && gap < bestGap) {
            best = zone;
            bestGap = gap;
        }
    }
    return best;
}

function expiryFor(kind: ConcealmentKind): number {
    if (kind === "roof") return 6500;
    if (kind === "smoke") return 4200;
    return 4800;
}

function baseConfidence(kind: ConcealmentKind): number {
    if (kind === "roof") return 0.82;
    if (kind === "bush") return 0.88;
    return 0.72;
}

export class ConcealmentTracker {
    private readonly visibleTracks = new Map<number, VisibleTrack>();
    private readonly contacts = new Map<number, HiddenContact>();

    update(
        observations: EnemyVisibilityObservation[],
        zones: ConcealmentZone[],
        timestamp: number,
    ): HiddenContact[] {
        const observedIds = new Set<number>();
        const zonesByKey = new Map(zones.map((zone) => [zone.key, zone]));

        for (const observation of observations) {
            observedIds.add(observation.enemyId);
            const previous = this.visibleTracks.get(observation.enemyId);

            if (observation.visible && observation.pos) {
                this.visibleTracks.set(observation.enemyId, {
                    pos: { ...observation.pos },
                    velocity: observation.velocity ? { ...observation.velocity } : { x: 0, y: 0 },
                    lastVisibleAt: timestamp,
                    wasVisible: true,
                    layer: observation.layer,
                });
                this.contacts.delete(observation.enemyId);
                continue;
            }

            if (previous?.wasVisible && timestamp - previous.lastVisibleAt <= 750) {
                const projectionTime = clamp((timestamp - previous.lastVisibleAt) / 1000 + 0.22, 0.16, 0.62);
                const projected = add(previous.pos, mul(previous.velocity, projectionTime));
                const zone = nearestConcealmentZone(projected, previous.layer, zones, 5.2)
                    ?? nearestConcealmentZone(previous.pos, previous.layer, zones, 3.2);
                if (zone) {
                    const constrained = constrainPointToZone(projected, zone, 0.78);
                    this.contacts.set(observation.enemyId, {
                        enemyId: observation.enemyId,
                        zoneKey: zone.key,
                        kind: zone.kind,
                        entryPos: { ...previous.pos },
                        estimatedPos: constrained,
                        lastVisibleVelocity: { ...previous.velocity },
                        confidence: baseConfidence(zone.kind),
                        hiddenAt: timestamp,
                        updatedAt: timestamp,
                        expiresAt: timestamp + expiryFor(zone.kind),
                        sweepSeed: ((observation.enemyId * 1103515245 + timestamp) >>> 0) & 0xffff,
                    });
                }
            }

            if (previous) previous.wasVisible = false;
        }

        // Enemies can disappear from the local object list when a roof or
        // vegetation occluder takes over. Convert that disappearance into the
        // same last-seen hypothesis used for an explicitly hidden object.
        for (const [enemyId, track] of this.visibleTracks) {
            if (!observedIds.has(enemyId) && track.wasVisible && timestamp - track.lastVisibleAt <= 750) {
                const projectionTime = clamp((timestamp - track.lastVisibleAt) / 1000 + 0.22, 0.16, 0.62);
                const projected = add(track.pos, mul(track.velocity, projectionTime));
                const zone = nearestConcealmentZone(projected, track.layer, zones, 5.2)
                    ?? nearestConcealmentZone(track.pos, track.layer, zones, 3.2);
                if (zone) {
                    this.contacts.set(enemyId, {
                        enemyId,
                        zoneKey: zone.key,
                        kind: zone.kind,
                        entryPos: { ...track.pos },
                        estimatedPos: constrainPointToZone(projected, zone, 0.78),
                        lastVisibleVelocity: { ...track.velocity },
                        confidence: baseConfidence(zone.kind) * 0.94,
                        hiddenAt: timestamp,
                        updatedAt: timestamp,
                        expiresAt: timestamp + expiryFor(zone.kind),
                        sweepSeed: ((enemyId * 1103515245 + timestamp) >>> 0) & 0xffff,
                    });
                }
            }
            if (!observedIds.has(enemyId)) track.wasVisible = false;
            if (timestamp - track.lastVisibleAt > 12000) this.visibleTracks.delete(enemyId);
        }

        for (const [enemyId, contact] of this.contacts) {
            const zone = zonesByKey.get(contact.zoneKey);
            if (!zone || zone.ceilingDead || timestamp >= contact.expiresAt) {
                this.contacts.delete(enemyId);
                continue;
            }
            const ageSeconds = Math.max(0, (timestamp - contact.hiddenAt) / 1000);
            const velocityTime = Math.min(ageSeconds, contact.kind === "roof" ? 1.3 : 0.8);
            const projected = add(contact.entryPos, mul(contact.lastVisibleVelocity, velocityTime));
            contact.estimatedPos = constrainPointToZone(projected, zone, 0.82);
            contact.updatedAt = timestamp;
            const decayPerSecond = contact.kind === "roof" ? 0.075 : contact.kind === "bush" ? 0.1 : 0.15;
            contact.confidence = clamp(baseConfidence(contact.kind) - ageSeconds * decayPerSecond, 0, 1);
            if (zone.ceilingDamaged && contact.kind === "roof") {
                contact.confidence = clamp(contact.confidence + 0.04, 0, 1);
            }
        }

        return this.all(timestamp);
    }

    all(timestamp: number): HiddenContact[] {
        return [...this.contacts.values()]
            .filter((contact) => contact.expiresAt > timestamp && contact.confidence > 0.12)
            .map((contact) => ({
                ...contact,
                entryPos: { ...contact.entryPos },
                estimatedPos: { ...contact.estimatedPos },
                lastVisibleVelocity: { ...contact.lastVisibleVelocity },
            }));
    }

    /**
     * Bridges an inferred shooter position into a smoke contact. Used when the
     * bot is shot from inside a smoke cloud it never saw anyone enter: the
     * one-way smoke ambush. The contact lets the hidden-area standoff response
     * (withdraw outside the 1x ring, suppress from cover) engage instead of
     * standing in the open firing blindly.
     */
    injectSmokeContact(input: {
        enemyId: number;
        zone: ConcealmentZone;
        estimatedPos: ConcealmentVec2;
        timestamp: number;
    }): void {
        const existing = this.contacts.get(input.enemyId);
        if (existing && existing.zoneKey === input.zone.key) {
            // Refresh: continuous fire keeps the ambush hypothesis alive.
            existing.confidence = Math.max(existing.confidence, 0.5);
            existing.updatedAt = input.timestamp;
            existing.expiresAt = input.timestamp + expiryFor("smoke");
            return;
        }
        this.contacts.set(input.enemyId, {
            enemyId: input.enemyId,
            zoneKey: input.zone.key,
            kind: "smoke",
            entryPos: { ...input.estimatedPos },
            estimatedPos: constrainPointToZone(input.estimatedPos, input.zone, 0.82),
            lastVisibleVelocity: { x: 0, y: 0 },
            confidence: 0.5,
            hiddenAt: input.timestamp,
            updatedAt: input.timestamp,
            expiresAt: input.timestamp + expiryFor("smoke"),
            sweepSeed: ((input.enemyId * 1103515245 + input.timestamp) >>> 0) & 0xffff,
        });
    }

    /**
     * Creates or refreshes a smoke contact from a fresh known enemy position
     * (last visual memory, or the per-second extraction human hint). Unlike
     * the ballistic bridge, this also updates the estimated position so the
     * blind-fire sweep tracks the player's latest known location inside the
     * cloud instead of locking onto the first sample.
     */
    refreshSmokeContact(input: {
        enemyId: number;
        zone: ConcealmentZone;
        estimatedPos: ConcealmentVec2;
        timestamp: number;
    }): void {
        const constrained = constrainPointToZone(input.estimatedPos, input.zone, 0.82);
        const existing = this.contacts.get(input.enemyId);
        if (existing && existing.zoneKey === input.zone.key) {
            existing.estimatedPos = constrained;
            existing.confidence = Math.max(existing.confidence, 0.5);
            existing.updatedAt = input.timestamp;
            existing.expiresAt = input.timestamp + expiryFor("smoke");
            return;
        }
        this.contacts.set(input.enemyId, {
            enemyId: input.enemyId,
            zoneKey: input.zone.key,
            kind: "smoke",
            entryPos: { ...constrained },
            estimatedPos: constrained,
            lastVisibleVelocity: { x: 0, y: 0 },
            confidence: 0.5,
            hiddenAt: input.timestamp,
            updatedAt: input.timestamp,
            expiresAt: input.timestamp + expiryFor("smoke"),
            sweepSeed: ((input.enemyId * 1103515245 + input.timestamp) >>> 0) & 0xffff,
        });
    }

    best(
        observerPos: ConcealmentVec2,
        timestamp: number,
        zones: ConcealmentZone[],
    ): HiddenContact | null {
        const zoneKeys = new Set(zones.map((zone) => zone.key));
        let best: HiddenContact | null = null;
        let bestScore = -Infinity;
        for (const contact of this.all(timestamp)) {
            if (!zoneKeys.has(contact.zoneKey)) continue;
            const age = (timestamp - contact.hiddenAt) / 1000;
            const score = contact.confidence * 125
                - distance(observerPos, contact.estimatedPos) * 0.42
                - age * 3.5
                + (contact.kind === "bush" ? 12 : contact.kind === "roof" ? 7 : 0);
            if (score > bestScore) {
                best = contact;
                bestScore = score;
            }
        }
        return best;
    }

    /** True when any tracked hidden contact is attributed to the given zone. */
    hasContactInZone(zoneKey: string): boolean {
        for (const contact of this.contacts.values()) {
            if (contact.zoneKey === zoneKey) return true;
        }
        return false;
    }

    clear(enemyId: number): void {
        this.contacts.delete(enemyId);
    }

    clearZone(zoneKey: string): void {
        for (const [enemyId, contact] of this.contacts) {
            if (contact.zoneKey === zoneKey) this.contacts.delete(enemyId);
        }
    }
}

export function constrainPointToZone(
    point: ConcealmentVec2,
    zone: ConcealmentZone,
    radiusFactor = 0.82,
): ConcealmentVec2 {
    const offset = sub(point, zone.center);
    const maxRadius = Math.max(0.5, zone.radius * radiusFactor);
    const len = length(offset);
    if (len <= maxRadius) return { ...point };
    return add(zone.center, mul(normalize(offset), maxRadius));
}

export function hiddenContactAimPoint(
    contact: HiddenContact,
    zone: ConcealmentZone,
    timestamp: number,
): ConcealmentVec2 {
    const ageStep = Math.floor(Math.max(0, timestamp - contact.hiddenAt) / 260);
    const seedAngle = ((contact.sweepSeed % 6283) / 1000) + ageStep * 2.399963;
    const ring = ageStep % 4;
    const radiusFactor = ring === 0 ? 0.12 : ring === 1 ? 0.34 : ring === 2 ? 0.58 : 0.78;
    const sweep = {
        x: zone.center.x + Math.cos(seedAngle) * zone.radius * radiusFactor,
        y: zone.center.y + Math.sin(seedAngle) * zone.radius * radiusFactor,
    };
    const memoryWeight = clamp(contact.confidence, 0.25, 0.82);
    return constrainPointToZone(
        {
            x: sweep.x * (1 - memoryWeight) + contact.estimatedPos.x * memoryWeight,
            y: sweep.y * (1 - memoryWeight) + contact.estimatedPos.y * memoryWeight,
        },
        zone,
        0.86,
    );
}

export function chooseHideZone(
    playerPos: ConcealmentVec2,
    zones: ConcealmentZone[],
    context: HideContext,
    maxDistance = 34,
): HideChoice | null {
    let best: HideChoice | null = null;
    for (const zone of zones) {
        if (zone.ceilingDead || zone.layer < 0 || zone.kind === "smoke") continue;
        const dist = distance(playerPos, zone.center);
        if (dist > maxDistance) continue;
        if (context.dangerousAt(zone.center, zone.radius + 2)) continue;
        const teammateCount = context.teammateCountAt(zone.center, Math.max(2.5, zone.radius * 0.65));
        if (teammateCount >= (zone.kind === "roof" ? 4 : 2)) continue;

        let score = zone.kind === "roof" ? 47 : 35;
        score -= dist * 1.15;
        score -= teammateCount * 12;
        score += context.recentlyDamaged ? 22 : 0;
        score += clamp((60 - context.health) * 0.65, 0, 28);
        score += zone.occupied && zone.kind === "roof" ? -7 : 0;
        score += zone.destructible && zone.healthT < 0.45 ? -18 : 0;

        if (context.enemyPos) {
            const enemyDistance = distance(zone.center, context.enemyPos);
            score += clamp(enemyDistance * 0.18, 0, 16);
            const away = normalize(sub(playerPos, context.enemyPos));
            const zoneDir = normalize(sub(zone.center, playerPos));
            score += (away.x * zoneDir.x + away.y * zoneDir.y) * 13;
        }

        if (context.circleCenter && context.circleRadius !== null) {
            const inside = distance(zone.center, context.circleCenter)
                <= Math.max(0, context.circleRadius - zone.radius - 1.5);
            score += inside ? 13 : -45;
        }

        const hidePoint = hidePointInsideZone(playerPos, zone, context.enemyPos);
        if (!best || score > best.score) best = { zone, hidePoint, score };
    }
    return best && best.score > 8 ? best : null;
}

export function hidePointInsideZone(
    playerPos: ConcealmentVec2,
    zone: ConcealmentZone,
    enemyPos: ConcealmentVec2 | null,
): ConcealmentVec2 {
    if (!enemyPos) {
        return constrainPointToZone(
            add(zone.center, mul(normalize(sub(playerPos, zone.center)), zone.radius * 0.16)),
            zone,
            0.48,
        );
    }
    const awayFromEnemy = normalize(sub(zone.center, enemyPos));
    return constrainPointToZone(
        add(zone.center, mul(awayFromEnemy, zone.radius * 0.34)),
        zone,
        0.58,
    );
}

/**
 * Derives a conservative radial footprint from the generated map definition.
 * Collider formats differ across definitions, so the walker accepts common
 * `min/max`, `extents`, `rad/radius`, `width/height`, `x/y` and AABB shapes.
 */
export function estimateDefinitionRadius(definition: unknown, fallback: number): number {
    const seen = new Set<object>();
    let maximum = Math.max(0.5, fallback);

    const visit = (value: unknown, depth: number): void => {
        if (depth > 7 || value === null || value === undefined) return;
        if (typeof value === "number") return;
        if (Array.isArray(value)) {
            for (const item of value) visit(item, depth + 1);
            return;
        }
        if (typeof value !== "object") return;
        if (seen.has(value as object)) return;
        seen.add(value as object);
        const record = value as Record<string, unknown>;

        const number = (key: string): number | null => {
            const candidate = record[key];
            return typeof candidate === "number" && Number.isFinite(candidate) ? Math.abs(candidate) : null;
        };
        const x = number("x");
        const y = number("y");
        if (x !== null && y !== null) maximum = Math.max(maximum, Math.hypot(x, y));
        const width = number("width");
        const height = number("height");
        if (width !== null || height !== null) {
            maximum = Math.max(maximum, Math.hypot(width ?? 0, height ?? 0) * 0.55);
        }
        maximum = Math.max(maximum, number("rad") ?? 0, number("radius") ?? 0);

        const min = record.min as Record<string, unknown> | undefined;
        const max = record.max as Record<string, unknown> | undefined;
        if (min && max) {
            const minX = typeof min.x === "number" ? min.x : 0;
            const minY = typeof min.y === "number" ? min.y : 0;
            const maxX = typeof max.x === "number" ? max.x : 0;
            const maxY = typeof max.y === "number" ? max.y : 0;
            maximum = Math.max(
                maximum,
                Math.hypot(Math.max(Math.abs(minX), Math.abs(maxX)), Math.max(Math.abs(minY), Math.abs(maxY))),
            );
        }

        for (const [key, child] of Object.entries(record)) {
            if (
                /collision|aabb|bound|extent|surface|zoom|floor|ceiling|shape/i.test(key)
            ) {
                visit(child, depth + 1);
            }
        }
    };

    visit(definition, 0);
    return clamp(maximum, fallback * 0.65, 30);
}
