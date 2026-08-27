import { GameConfig } from "../../../shared/gameConfig.ts";

/*
 * Combat perception helpers for the surviv.io bot.
 *
 * This module intentionally consumes only information that the normal client
 * receives: current scope/zoom, visible bullet events, and visible world
 * objects. It does not inspect server-only player state.
 */

export interface CombatVec2 {
    x: number;
    y: number;
}

export interface BulletObservation {
    playerId: number;
    pos: CombatVec2;
    dir: CombatVec2;
    bulletType: string;
    layer: number;
    observedAt: number;
    bulletSpeed: number;
    bulletRange: number;
    damage: number;
    obstacleDamage: number;
    shrapnel: boolean;
    reflectCount?: number;
    reflectObjId?: number;
}

export function reconstructObservedBulletRange(input: {
    definitionDistance: number;
    definitionVariance: number;
    varianceT: number;
    distAdjIdx: number;
    reflectCount: number;
    clipDistance: boolean;
    clippedDistance: number;
}): number {
    if (input.clipDistance && Number.isFinite(input.clippedDistance)) {
        // The wire serializes Bullet.distance here, which is already the final
        // clipped range after variance and distance jitter.
        return Math.max(0, input.clippedDistance);
    }
    const reflectDecay = Math.pow(
        GameConfig.bullet.reflectDistDecay,
        Math.max(0, Math.floor(input.reflectCount)),
    );
    const baseDistance = Math.max(0, input.definitionDistance) / Math.max(0.001, reflectDecay);
    const variance = 1
        + Math.max(0, Math.min(1, input.varianceT)) * Number(input.definitionVariance || 0);
    const adjustedIndex = Math.max(0, Math.min(16, Math.floor(input.distAdjIdx)));
    const distanceJitter = -1 + (adjustedIndex / 16) * 2;
    return Math.max(0, baseDistance * variance + distanceJitter);
}

export interface BallisticThreat {
    key: string;
    playerId: number;
    /** 子弹观测所属 layer。反击时必须保留，防止跨楼层二维误判。 */
    layer: number;
    estimatedShooterPos: CombatVec2;
    incomingDir: CombatVec2;
    entryPos: CombatVec2;
    confidence: number;
    closestApproach: number;
    bulletType: string;
    bulletSpeed: number;
    damage: number;
    samples: number;
    updatedAt: number;
    expiresAt: number;
    /** A reflected segment starts at the ricochet point, not at the muzzle. */
    reflected: boolean;
}

export interface WeaponMasteryContext {
    distance: number;
    targetSpeed: number;
    targetMoving: boolean;
    shooterMoving: boolean;
    targetBehindCover: boolean;
    coverHealthT: number;
    clusteredEnemies: number;
    ammoInClip: number;
    reserveAmmo: number;
    currentWeapon: boolean;
    maxScopeLevel: number;
    gasPhase: "early" | "mid" | "late" | "final" | string;
    underAirstrike: boolean;
    allyCount: number;
    /** Currently equipped weapon type. Used to model real switch latency. */
    lastWeaponType?: string;
    /** 1 = normal explosives; lower values model Flak Jacket or similar resistance. */
    explosiveEffectiveness?: number;
    /** Small situational score bonus from mobility perks such as Windwalk. */
    mobilityBonus?: number;
}

export interface WeaponMasteryDef {
    type: string;
    fireMode?: string;
    autoAttack?: boolean;
    fireDelay?: number;
    maxClip?: number;
    reloadTime?: number;
    shotSpread?: number;
    moveSpread?: number;
    bulletCount?: number;
    ammo?: string;
    isLauncher?: boolean;
    burstCount?: number;
    burstDelay?: number;
    switchDelay?: number;
}

export interface BulletMasteryDef {
    damage?: number;
    obstacleDamage?: number;
    obstacleMultiplier?: number;
    falloff?: number;
    distance?: number;
    speed?: number;
    variance?: number;
    shrapnel?: boolean;
    onHit?: string;
    skipCollision?: boolean;
}

export interface MasteryScore {
    score: number;
    idealRange: number;
    preferredBurstMs: number;
    stopToShoot: boolean;
    leadFactor: number;
    coverBreakValue: number;
}

export interface ViewportBounds {
    halfWidth: number;
    halfHeight: number;
    radius: number;
    scopeLevel: number;
    scopeType: string;
}

export type UnseenDamageResponseMode =
    | "none"
    | "trajectory-counterfire"
    | "remembered-cover"
    | "blind-juke";

export interface UnseenDamageResponseInput {
    millisecondsSinceDamage: number;
    visibleAttacker: boolean;
    environmentalDamage: boolean;
    ballisticConfidence: number;
    ballisticAgeMs: number;
    rememberedThreatAgeMs: number;
}

export type GunfireSafetyTargetKind =
    | "enemy"
    | "blindfire"
    | "counterfire"
    | "hidden-contact"
    | "tactical-object";

export interface GunfireSafetyTarget {
    pos: CombatVec2;
    layer: number;
    kind: GunfireSafetyTargetKind;
}

export interface CounterfireSafetyIntent {
    pos: CombatVec2;
    layer: number;
    expiresAt: number;
}

/**
 * The packet-level safety checks must validate the target that requested the
 * shot, not an unrelated retained enemy lock. A fresh trajectory response wins
 * only while the bot is actually in counterfire state; otherwise normal target
 * selection remains authoritative.
 */
export function chooseGunfireSafetyTarget(input: {
    currentState: string;
    timestamp: number;
    counterfireIntent: CounterfireSafetyIntent | null;
    fallback: GunfireSafetyTarget | null;
}): GunfireSafetyTarget | null {
    const intent = input.counterfireIntent;
    if (
        input.currentState === "counterfire"
        && intent
        && Number.isFinite(intent.expiresAt)
        && input.timestamp <= intent.expiresAt
    ) {
        return {
            pos: { x: intent.pos.x, y: intent.pos.y },
            layer: intent.layer,
            kind: "counterfire",
        };
    }
    return input.fallback;
}

/**
 * A health delta confirms that an otherwise weak bullet bearing matters. This
 * policy still uses only client-visible evidence: a recent trajectory wins,
 * then a recently seen hostile position, and finally a short direction-agnostic
 * juke. Gas and airstrike damage are left to their dedicated survival branches.
 */
export function chooseUnseenDamageResponse(
    input: UnseenDamageResponseInput,
): UnseenDamageResponseMode {
    if (
        input.environmentalDamage
        || input.visibleAttacker
        || !Number.isFinite(input.millisecondsSinceDamage)
        || input.millisecondsSinceDamage < 0
        || input.millisecondsSinceDamage > 1300
    ) {
        return "none";
    }
    if (
        input.ballisticConfidence >= 0.28
        && input.ballisticAgeMs >= 0
        && input.ballisticAgeMs <= 1100
    ) {
        return "trajectory-counterfire";
    }
    if (
        input.rememberedThreatAgeMs >= 0
        && input.rememberedThreatAgeMs <= 3600
    ) {
        return "remembered-cover";
    }
    return "blind-juke";
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const sqr = (value: number): number => value * value;
const lengthSq = (value: CombatVec2): number => sqr(value.x) + sqr(value.y);
const length = (value: CombatVec2): number => Math.sqrt(lengthSq(value));
const add = (a: CombatVec2, b: CombatVec2): CombatVec2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: CombatVec2, b: CombatVec2): CombatVec2 => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: CombatVec2, scalar: number): CombatVec2 => ({ x: a.x * scalar, y: a.y * scalar });
const dot = (a: CombatVec2, b: CombatVec2): number => a.x * b.x + a.y * b.y;
const normalize = (value: CombatVec2, fallback: CombatVec2 = { x: 1, y: 0 }): CombatVec2 => {
    const len = length(value);
    return len > 0.0001 ? { x: value.x / len, y: value.y / len } : fallback;
};
const distance = (a: CombatVec2, b: CombatVec2): number => length(sub(a, b));

const SCOPE_LEVELS: Record<string, number> = {
    "1xscope": 1,
    "2xscope": 2,
    "4xscope": 4,
    "8xscope": 8,
    "15xscope": 15,
};

const DESKTOP_SCOPE_RADIUS: Record<string, number> = GameConfig.scopeZoomRadius.desktop;

/**
 * The normal desktop camera treats the configured scope zoom as the visible
 * horizontal half-width on a 16:9 display. The vertical half-height is derived
 * from the real client camera normalization in client/src/game.ts. Keeping the
 * same formula here prevents the bot from using the old, oversized rectangle
 * (zoom * aspect by zoom) and firing at objects that are not on a player's
 * screen.
 */
export function cameraViewportHalfExtents(
    zoomRadius: number,
    aspectRatio = 16 / 9,
): { halfWidth: number; halfHeight: number } {
    const radius = clamp(
        Number.isFinite(zoomRadius) ? zoomRadius : DESKTOP_SCOPE_RADIUS["1xscope"],
        12,
        DESKTOP_SCOPE_RADIUS["15xscope"],
    );
    const safeAspect = clamp(Number(aspectRatio) || 16 / 9, 0.5, 3.5);
    const width = safeAspect >= 1 ? safeAspect : 1;
    const height = safeAspect >= 1 ? 1 : 1 / safeAspect;
    const minDim = Math.min(width, height);
    const maxDim = Math.max(width, height);
    const normalizedMaxDim = Math.max(minDim * (16 / 9), maxDim);
    return {
        halfWidth: (width * radius) / normalizedMaxDim,
        halfHeight: (height * radius) / normalizedMaxDim,
    };
}

export function maxOwnedScope(
    equippedScope: string,
    inventory: Record<string, number>,
): { type: string; level: number; radius: number } {
    let type = equippedScope && SCOPE_LEVELS[equippedScope] ? equippedScope : "1xscope";
    let level = SCOPE_LEVELS[type] ?? 1;
    for (const [candidate, candidateLevel] of Object.entries(SCOPE_LEVELS)) {
        if ((inventory[candidate] ?? 0) > 0 && candidateLevel > level) {
            type = candidate;
            level = candidateLevel;
        }
    }
    return {
        type,
        level,
        radius: DESKTOP_SCOPE_RADIUS[type] ?? 28,
    };
}

export function viewportForMaxScope(
    playerPos: CombatVec2,
    equippedZoom: number,
    equippedScope: string,
    inventory: Record<string, number>,
    aspectRatio = 16 / 9,
): ViewportBounds {
    void playerPos;
    void inventory;
    // Target acquisition must match the camera the player is using now. The
    // previous implementation expanded the viewport to the strongest scope in
    // the backpack, which let stale objects remain targetable outside a normal
    // player's screen. Weapon scoring may still inspect maxOwnedScope(), but
    // direct vision uses only the server-synchronised active zoom and scope.
    const scopeType = SCOPE_LEVELS[equippedScope] ? equippedScope : "1xscope";
    const fallbackRadius = DESKTOP_SCOPE_RADIUS[scopeType] ?? 28;
    const reportedZoom = Number.isFinite(equippedZoom) && equippedZoom > 0
        ? equippedZoom
        : fallbackRadius;
    const radius = clamp(reportedZoom, 12, DESKTOP_SCOPE_RADIUS["15xscope"]);
    const extents = cameraViewportHalfExtents(radius, aspectRatio);
    // Reserve a thin edge band for camera interpolation and player radius. A
    // target whose centre is in this band may be partly visible, but the bot
    // must first move/turn it fully into view before treating it as a live shot.
    const safetyInset = 0.9;
    return {
        halfWidth: Math.max(1, extents.halfWidth - safetyInset),
        halfHeight: Math.max(1, extents.halfHeight - safetyInset),
        radius: Math.max(1, extents.halfWidth - safetyInset),
        scopeLevel: SCOPE_LEVELS[scopeType] ?? 1,
        scopeType,
    };
}

export function pointInsideViewport(
    playerPos: CombatVec2,
    point: CombatVec2,
    viewport: ViewportBounds,
    margin = 0,
): boolean {
    return (
        Math.abs(point.x - playerPos.x) <= viewport.halfWidth + margin
        && Math.abs(point.y - playerPos.y) <= viewport.halfHeight + margin
    );
}

export function segmentClosestApproach(
    rayPos: CombatVec2,
    rayDir: CombatVec2,
    point: CombatVec2,
): { distance: number; along: number } {
    const dir = normalize(rayDir);
    const relative = sub(point, rayPos);
    const along = dot(relative, dir);
    const closest = add(rayPos, mul(dir, Math.max(0, along)));
    return { distance: distance(closest, point), along };
}

interface ThreatAccumulator extends BallisticThreat {
    weightedPos: CombatVec2;
    totalWeight: number;
}

/**
 * Fuses short-lived bullet-entry bearings into shooter sectors. The caller may
 * discard playerId for aiming; it is retained mainly to reject teammate fire
 * and merge successive shots from the same visible client event stream.
 */
export class BallisticInferenceEngine {
    private readonly threats = new Map<string, ThreatAccumulator>();
    private readonly MAX_THREATS = 24;
    private readonly CLEANUP_INTERVAL = 400;
    private lastCleanupAt = 0;

    observe(
        observation: BulletObservation,
        playerPos: CombatVec2,
        viewport: ViewportBounds,
        isTeammate: (playerId: number) => boolean,
    ): BallisticThreat | null {
        if (observation.layer < 0 || observation.shrapnel) return null;
        if (observation.playerId > 0 && isTeammate(observation.playerId)) return null;

        const incoming = segmentClosestApproach(observation.pos, observation.dir, playerPos);
        // UpdateMsg serializes newBullet.startPos (the muzzle), including shots
        // whose finite segment crosses the client's viewport from an off-screen
        // shooter. Requiring that muzzle to be on-screen discarded precisely the
        // long-range attacks this inference is meant to answer.
        if (
            incoming.along < -1
            || incoming.along > Math.max(1, observation.bulletRange) + 1
            || incoming.distance > 9.5
        ) {
            return null;
        }

        const dir = normalize(observation.dir);
        const reverse = mul(dir, -1);
        const entryDistance = distance(playerPos, observation.pos);
        // startPos is already the best client-visible shooter estimate. The old
        // extra backtrack moved every estimate 10+ units behind the real muzzle.
        const estimatedShooterPos = { x: observation.pos.x, y: observation.pos.y };
        const reflected = Number(observation.reflectCount ?? 0) > 0;
        const sector = Math.round(Math.atan2(reverse.y, reverse.x) / 0.16);
        // 同一玩家在不同楼层产生的子弹不能融合成一个二维威胁。
        // 把 layer 写入 key，避免楼上旧轨迹污染楼下的新轨迹。
        const keyBase = observation.playerId > 0 ? `p:${observation.playerId}` : `s:${sector}`;
        const reflectionKey = reflected
            ? `:r${Number(observation.reflectCount ?? 0)}:${Number(observation.reflectObjId ?? 0)}`
            : ":direct";
        const key = `${keyBase}:l${observation.layer}${reflectionKey}`;

        const directness = 1 - clamp(incoming.distance / 9.5, 0, 1);
        const danger = clamp(observation.damage / 80, 0.08, 1);
        const entryEdgeFactor = clamp(entryDistance / Math.max(1, viewport.radius), 0.25, 1.4);
        const sampleConfidence = clamp(
            0.34 + directness * 0.34 + danger * 0.14 + entryEdgeFactor * 0.08,
            0.28,
            0.9,
        );
        const weight = 0.6 + sampleConfidence;
        const existing = this.threats.get(key);
        const now = observation.observedAt;

        if (
            existing
            && existing.layer === observation.layer
            && now - existing.updatedAt <= 1400
        ) {
            existing.weightedPos = add(existing.weightedPos, mul(estimatedShooterPos, weight));
            existing.totalWeight += weight;
            existing.estimatedShooterPos = mul(existing.weightedPos, 1 / existing.totalWeight);
            existing.incomingDir = normalize(add(mul(existing.incomingDir, 0.72), mul(dir, 0.28)));
            existing.entryPos = observation.pos;
            existing.closestApproach = Math.min(existing.closestApproach, incoming.distance);
            existing.samples += 1;
            existing.confidence = clamp(
                Math.max(existing.confidence, sampleConfidence) + Math.min(0.22, existing.samples * 0.035),
                0,
                0.98,
            );
            existing.bulletType = observation.bulletType;
            existing.bulletSpeed = observation.bulletSpeed;
            existing.damage = Math.max(existing.damage, observation.damage);
            existing.reflected = reflected;
            existing.updatedAt = now;
            existing.expiresAt = now + 2100;
            this.trimToLimit();
            return { ...existing };
        }

        const created: ThreatAccumulator = {
            key,
            playerId: observation.playerId,
            layer: observation.layer,
            estimatedShooterPos,
            incomingDir: dir,
            entryPos: observation.pos,
            confidence: sampleConfidence,
            closestApproach: incoming.distance,
            bulletType: observation.bulletType,
            bulletSpeed: observation.bulletSpeed,
            damage: observation.damage,
            samples: 1,
            updatedAt: now,
            expiresAt: now + 1800,
            reflected,
            weightedPos: mul(estimatedShooterPos, weight),
            totalWeight: weight,
        };
        this.threats.set(key, created);
        this.trimToLimit();
        return { ...created };
    }

    best(playerPos: CombatVec2, timestamp: number): BallisticThreat | null {
        this.maybeCleanup(timestamp);
        let best: ThreatAccumulator | null = null;
        let bestScore = -Infinity;

        for (const threat of this.threats.values()) {
            const age = timestamp - threat.updatedAt;
            const dist = distance(playerPos, threat.estimatedShooterPos);
            const timeToImpact = threat.closestApproach / Math.max(20, threat.bulletSpeed);
            const urgency = clamp(1 - timeToImpact / 1.4, 0, 1) * 55;
            const distPenalty = clamp(dist / 200, 0, 1) * 20;
            const recent = age < 380 ? 14 : 0;
            const sample = Math.min(threat.samples * 5, 25);
            const highDamage = threat.damage > 55 ? 10 : 0;

            const score = threat.confidence * 90
                + urgency
                - threat.closestApproach * 2.7
                - age * 0.02
                - distPenalty
                + sample
                + recent
                + highDamage;

            if (score > bestScore) {
                best = threat;
                bestScore = score;
            }
        }
        return best ? { ...best } : null;
    }

    threatForPlayer(
        playerId: number,
        timestamp: number,
        preferredLayer?: number,
    ): BallisticThreat | null {
        if (!playerId) return null;
        this.maybeCleanup(timestamp);

        // 威胁 key 已包含 layer，不能再按旧的 p:<id> 直接索引。
        // 优先返回调用者指定楼层的最新威胁；未指定时返回该玩家最新的一条。
        let best: ThreatAccumulator | null = null;
        for (const threat of this.threats.values()) {
            if (threat.playerId !== playerId || threat.expiresAt <= timestamp) continue;
            if (preferredLayer !== undefined && threat.layer !== preferredLayer) continue;
            if (!best || threat.updatedAt > best.updatedAt) best = threat;
        }
        return best ? { ...best } : null;
    }

    private maybeCleanup(timestamp: number): void {
        if (timestamp - this.lastCleanupAt < this.CLEANUP_INTERVAL) return;
        this.cleanup(timestamp);
    }

    private trimToLimit(): void {
        while (this.threats.size > this.MAX_THREATS) {
            let oldestKey: string | null = null;
            let oldestTime = Infinity;
            for (const [key, threat] of this.threats) {
                const time = Math.min(threat.expiresAt, threat.updatedAt);
                if (time < oldestTime) {
                    oldestTime = time;
                    oldestKey = key;
                }
            }
            if (oldestKey === null) break;
            this.threats.delete(oldestKey);
        }
    }

    cleanup(timestamp: number): void {
        this.lastCleanupAt = timestamp;
        for (const [key, threat] of this.threats) {
            if (threat.expiresAt <= timestamp) this.threats.delete(key);
        }
        this.trimToLimit();
    }
}

export function scoreWeaponMastery(
    weapon: WeaponMasteryDef,
    bullet: BulletMasteryDef | undefined,
    context: WeaponMasteryContext,
): MasteryScore {
    if (!bullet) {
        return {
            score: -900,
            idealRange: 5,
            preferredBurstMs: 180,
            stopToShoot: false,
            leadFactor: 1,
            coverBreakValue: 0,
        };
    }

    const damagePerPellet = Math.max(0, Number(bullet.damage ?? 0));
    const pelletCount = Math.max(1, Number(weapon.bulletCount ?? 1));
    const volleyDamage = damagePerPellet * pelletCount;
    const fireDelay = Math.max(0.035, Number(weapon.fireDelay ?? 0.25));
    const burstCount = Math.max(1, Number(weapon.burstCount ?? 1));
    const cyclicDps = (volleyDamage * burstCount) / Math.max(fireDelay, fireDelay + Number(weapon.burstDelay ?? 0));
    const range = Math.max(8, Number(bullet.distance ?? 60));
    const speed = Math.max(20, Number(bullet.speed ?? 90));
    const spread = Math.max(0, Number(weapon.shotSpread ?? 0) + Number(weapon.moveSpread ?? 0) * 0.45);
    const obstacleDamage = Math.max(0, Number(bullet.obstacleDamage ?? 0));
    const obstacleMultiplier = Math.max(0.1, Number(bullet.obstacleMultiplier ?? 1));
    const explosive = Boolean(bullet.onHit) || Boolean(weapon.isLauncher);
    const explosiveEffectiveness = clamp(Number(context.explosiveEffectiveness ?? 1), 0.2, 1.35);
    const shotgun = pelletCount > 1;
    const automatic = weapon.fireMode === "auto" || weapon.autoAttack === true;
    const semiPrecision = !automatic && !shotgun && range >= 180;

    let idealRange = clamp(range * (shotgun ? 0.58 : semiPrecision ? 0.62 : automatic ? 0.5 : 0.56), 4, 95);
    if (explosive) idealRange = clamp(range * 0.55, 13, 70);

    const distanceFit = 1 - clamp(Math.abs(context.distance - idealRange) / Math.max(12, idealRange * 1.2), 0, 1);
    const rangeValidity = context.distance <= range ? 1 : clamp(1 - (context.distance - range) / 45, 0, 1);
    const hitQuality = clamp(1 - spread / (shotgun ? 16 : 10), 0.1, 1);
    const ammoSecurity = clamp(
        (context.ammoInClip + Math.min(context.reserveAmmo, 60)) / Math.max(5, Number(weapon.maxClip ?? 20)),
        0,
        1.5,
    );
    const movementPenalty = context.shooterMoving && semiPrecision ? 25 : context.shooterMoving ? spread * 0.6 : 0;
    const targetMotionBonus = context.targetMoving ? speed * 0.045 : 0;
    const scopeSynergy = semiPrecision ? Math.min(22, context.maxScopeLevel * 1.7) : 0;
    const clusterBonus = explosive
        ? Math.max(0, context.clusteredEnemies - 1) * 28 * explosiveEffectiveness
        : 0;
    let falloffFit = 1;
    if (Number.isFinite(Number(bullet.falloff)) && Number(bullet.distance ?? 0) > 0) {
        const t = clamp(context.distance / Math.max(1, Number(bullet.distance)), 0, 1);
        falloffFit = 1 - (1 - clamp(Number(bullet.falloff), 0, 1)) * t * 0.55;
    }

    let phaseBonus = 0;
    if (context.gasPhase === "final" && semiPrecision) phaseBonus += 20;
    if (context.gasPhase === "final" && automatic && context.distance < 36) phaseBonus += 9;
    if (context.underAirstrike && explosive) phaseBonus -= 28;
    if (context.allyCount >= 3 && shotgun) phaseBonus += 13;

    const coverBreakValue = context.targetBehindCover
        ? obstacleDamage * obstacleMultiplier * (1.35 + (1 - clamp(context.coverHealthT, 0, 1)) * 1.7)
            + cyclicDps * 0.012
        : 0;
    const currentBonus = context.currentWeapon ? 5 : 0;
    const switchPenalty = context.lastWeaponType && context.lastWeaponType !== weapon.type
        ? Math.max(0, Number(weapon.switchDelay ?? 0)) * 8
        : 0;
    const perkExplosivePenalty = explosive ? (1 - explosiveEffectiveness) * 45 : 0;
    const mobilityBonus = Number(context.mobilityBonus ?? 0);

    const score = cyclicDps * 0.055
        + volleyDamage * 0.52
        + range * 0.105
        + speed * 0.065
        + distanceFit * 48
        + rangeValidity * 26
        + falloffFit * 36
        + phaseBonus
        + hitQuality * 22
        + ammoSecurity * 13
        + targetMotionBonus
        + scopeSynergy
        + clusterBonus
        + coverBreakValue
        + currentBonus
        + mobilityBonus
        - switchPenalty
        - perkExplosivePenalty
        - movementPenalty
        - (context.ammoInClip <= 0 && context.reserveAmmo <= 0 ? 180 : 0);

    return {
        score,
        idealRange,
        preferredBurstMs: automatic
            ? clamp(220 + context.distance * 3.2, 220, 620)
            : shotgun
            ? 120
            : 80,
        stopToShoot: semiPrecision || spread >= 7.5,
        leadFactor: clamp(0.88 + context.targetSpeed / Math.max(70, speed) * 0.45, 0.82, 1.28),
        coverBreakValue,
    };
}

export function estimateShooterSearchPoint(
    threat: BallisticThreat,
    playerPos: CombatVec2,
    viewport: ViewportBounds,
): CombatVec2 {
    const reverse = normalize(mul(threat.incomingDir, -1));
    const predicted = threat.estimatedShooterPos;
    if (pointInsideViewport(playerPos, predicted, viewport, 1)) return predicted;
    // Aim at the screen edge in the inferred direction so the camera/aim turns
    // toward the shooter sector without using an off-screen entity lock.
    const xScale = Math.abs(reverse.x) > 0.0001 ? viewport.halfWidth / Math.abs(reverse.x) : Infinity;
    const yScale = Math.abs(reverse.y) > 0.0001 ? viewport.halfHeight / Math.abs(reverse.y) : Infinity;
    const scale = Math.min(xScale, yScale) * 0.92;
    return add(playerPos, mul(reverse, scale));
}
