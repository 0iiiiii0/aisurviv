import { coldet } from "../../../shared/utils/coldet.ts";
import type { Vec2 } from "../../../shared/utils/v2.ts";
import { assessCoverProtection } from "./coverPreservation.ts";
import { shouldQuickSwitch } from "./dualSwitch.ts";
import type { DualSwitchEvaluation as QuickSwitchEvaluation } from "./dualSwitch.ts";

export { shouldQuickSwitch };
export type { QuickSwitchEvaluation };

export type ForbiddenDifficulty = "forbidden" | "legit";
export type ForbiddenPerception = "omniscient" | "line-of-sight";

export interface ForbiddenWeaponSnapshot {
    type: string;
    ammo: number;
    cooldown: number;
    recoilTime: number;
}

export interface ForbiddenPlayerSnapshot {
    id: number;
    pos: Vec2;
    velocity: Vec2;
    dir: Vec2;
    layer: number;
    health: number;
    dead: boolean;
    downed: boolean;
    activeWeapon: string;
    curWeapIdx: number;
    weapons: ForbiddenWeaponSnapshot[];
    actionType: number;
    actionItem: string;
    actionTime: number;
    actionDuration: number;
    zoom: number;
    indoors: boolean;
    lineClearFromBot: boolean;
    shotSlowdownTimer: number;
    postSlowdownSpeed: number;
}

export type ForbiddenColliderSnapshot =
    | { type: 0; pos: Vec2; rad: number }
    | { type: 1; min: Vec2; max: Vec2 };

export interface ForbiddenObstacleSnapshot {
    id: number;
    type: string;
    pos: Vec2;
    layer: number;
    height: number;
    health: number;
    maxHealth: number;
    healthT: number;
    dead: boolean;
    collidable: boolean;
    destructible: boolean;
    armorPlated: boolean;
    stonePlated: boolean;
    reflectBullets?: boolean;
    explosionType: string;
    explosionRadius: number;
    collider: ForbiddenColliderSnapshot;
}

export interface ForbiddenBulletSnapshot {
    id: number;
    playerId: number;
    pos: Vec2;
    dir: Vec2;
    speed: number;
    damage: number;
    remainingDistance: number;
    bulletType: string;
    layer: number;
}

export interface ForbiddenProjectileSnapshot {
    playerId: number;
    pos: Vec2;
    velocity: Vec2;
    dir: Vec2;
    fuseTime: number;
    type: string;
    layer: number;
    /** Seconds until the first airstrike lane becomes dangerous. */
    strikeTime: number;
    /** Approximate duration of all staggered strike lanes. */
    strikeDuration: number;
    /** Conservative lethal/serious-damage radius around each lane. */
    strikeRadius: number;
}

export interface ForbiddenContextSnapshot {
    type: "forbidden-context";
    perception: ForbiddenPerception;
    sequence: number;
    generatedAt: number;
    gameId: string;
    mapName: string;
    mapWidth: number;
    mapHeight: number;
    botPlayerId: number;
    bot: ForbiddenPlayerSnapshot | null;
    enemies: ForbiddenPlayerSnapshot[];
    bullets: ForbiddenBulletSnapshot[];
    projectiles: ForbiddenProjectileSnapshot[];
    obstacles: ForbiddenObstacleSnapshot[];
}

export interface ForbiddenContextRequest {
    type: "forbidden-context-request";
    sequence: number;
    gameId: string;
    botPlayerId: number;
    difficulty: ForbiddenDifficulty;
}

export function predictLegitLastSeenPosition(
    enemy: ForbiddenPlayerSnapshot | null,
    ageMs: number,
    memoryMs = 1450,
): Vec2 | null {
    if (!enemy || !Number.isFinite(ageMs) || ageMs < 0 || ageMs > memoryMs) return null;
    const extrapolationSeconds = Math.min(0.45, ageMs / 1000);
    return {
        x: enemy.pos.x + enemy.velocity.x * extrapolationSeconds,
        y: enemy.pos.y + enemy.velocity.y * extrapolationSeconds,
    };
}

export interface InterceptSolution {
    aimPoint: Vec2;
    time: number;
    exact: boolean;
}

export interface BulletThreat {
    bullet: ForbiddenBulletSnapshot;
    closestTime: number;
    closestDistance: number;
    impactPoint: Vec2;
    danger: number;
}

export interface DodgeSolution {
    direction: Vec2;
    danger: number;
    threats: BulletThreat[];
    stationaryHits: number;
    remainingHits: number;
    avoidedHits: number;
    stationarySeparation: number;
    minimumSeparation: number;
}

export interface SpeedRecoveryInterceptInput {
    shooterPos: Vec2;
    targetPos: Vec2;
    slowedVelocity: Vec2;
    recoveredVelocity: Vec2;
    slowdownRemaining: number;
    projectileSpeed: number;
    maxTime?: number;
}

export interface ForbiddenShotPathInput {
    from: Vec2;
    to: Vec2;
    layer: number;
    obstacles: readonly ForbiddenObstacleSnapshot[];
    bulletDamage: number;
    obstacleDamage: number;
    armorPiercing: boolean;
    stonePiercing: boolean;
    enemyPos: Vec2;
    enemyHealth: number;
    enemyHealing: boolean;
    enemyUsingCover?: boolean;
    targetDistance?: number;
}

export type ForbiddenShotPathDecision =
    | { kind: "clear" }
    | { kind: "hold"; blocker: ForbiddenObstacleSnapshot }
    | { kind: "destroy"; blocker: ForbiddenObstacleSnapshot; shots: number }
    | { kind: "explode"; blocker: ForbiddenObstacleSnapshot; aimPoint: Vec2 }
    | { kind: "wait-peek"; blocker: ForbiddenObstacleSnapshot };

export interface AimThreatInput {
    shooterPos: Vec2;
    shooterDir: Vec2;
    targetPos: Vec2;
    weaponRange: number;
    weaponReady: boolean;
    spreadRadians?: number;
}

export interface PeekBaitSample {
    visible: boolean;
    timestamp: number;
}

export interface CadenceEvasionInput {
    score: number;
    elapsedMs: number;
    previousLateralSign: number;
    currentLateralSign: number;
    msSinceLastShot: number;
}

export interface ForbiddenMotionEstimateInput {
    currentPos: Vec2;
    authoritativeVelocity: Vec2;
    previousPos?: Vec2 | null;
    previousVelocity?: Vec2 | null;
    deltaSeconds: number;
}

export interface AutomaticPrecisionInput {
    fireMode: string;
    bulletCount: number;
    moveSpread: number;
    shotSpread: number;
    targetDistance: number;
    lineClear: boolean;
    imminentThreat: boolean;
}

export interface ForbiddenReloadCandidate {
    slot: number;
    ammo: number;
    maxClip: number;
    reloadable: boolean;
    score: number;
}

export interface ForbiddenReloadPlan {
    slot: number;
    targetAmmo: number;
    urgent: boolean;
}

export interface ForbiddenEmptyWeaponRecoveryInput {
    currentSlot: number;
    currentAmmo: number;
    currentReloadable: boolean;
    otherSlot: number;
    otherAmmo: number;
    otherReloadable: boolean;
    reloading: boolean;
    reloadPending: boolean;
}

export type ForbiddenEmptyWeaponRecovery =
    | { kind: "reload"; slot: number; hold: boolean }
    | { kind: "switch"; slot: number }
    | { kind: "melee" };

export type ForbiddenCoverMode = "reload" | "rifle" | "melee" | "sniper";

export interface ForbiddenCoverChoice {
    point: Vec2;
    obstacleId: number;
    score: number;
    blocksEnemy: boolean;
}

export interface ForbiddenCoverThreat {
    obstacleDamagePerShot: number;
    fireDelaySeconds: number;
}

export interface ForbiddenAirstrikeEscape {
    direction: Vec2;
    danger: number;
    imminentIn: number;
    hazards: number;
}

export interface ForbiddenCounterStrobePlan {
    barrageCount: number;
    reserveCount: number;
    carpet: boolean;
}

export interface ForbiddenStrobeCoverageTarget {
    pos: Vec2;
}

export interface ForbiddenStrobeCarpetInput {
    botPos: Vec2;
    botVelocity: Vec2;
    enemyPos: Vec2;
    enemyVelocity: Vec2;
    enemyDir: Vec2;
    layer: number;
    obstacles: readonly ForbiddenObstacleSnapshot[];
    mapWidth: number;
    mapHeight: number;
    throwIndex: number;
    barrageCount: number;
    existingTargets: readonly ForbiddenStrobeCoverageTarget[];
    /** Widen coverage when countering several hostile airstrike beacons. */
    wideCoverage?: boolean;
    /**
     * Opening-barrage mode (duel round start). The enemy may still be far
     * outside the strobe envelope, so the planner throws a max-range forward
     * strike toward the enemy's predicted position instead of refusing to
     * waste a beacon. Consecutive throws advance the strike curtain toward
     * the enemy as the bot closes distance.
     */
    openingBarrage?: boolean;
}

export interface ForbiddenStrobeThrowPlan {
    /** Point to feed into the ordinary player aim input. */
    aimPoint: Vec2;
    /** Predicted location of the strobe when the first strike is scheduled. */
    landingPoint: Vec2;
    /** Desired uncovered enemy-space center. */
    coveragePoint: Vec2;
    /** Ordinary mouse distance used by the server throw-strength formula. */
    mouseLen: number;
    /** Expected seconds until the first bombs can reach the ground. */
    impactDelay: number;
    coverageScore: number;
}

export interface ForbiddenGrenadeThrowInput {
    botPos: Vec2;
    botVelocity: Vec2;
    desiredImpactPoint: Vec2;
    layer: number;
    obstacles: readonly ForbiddenObstacleSnapshot[];
    mapWidth: number;
    mapHeight: number;
    /** Preferred flight time. Ordinary planning still searches the full safe window. */
    flightSeconds?: number;
    /**
     * "exact" is used after the pin has already been pulled: remaining fuse is
     * immutable, so the solver must match that flight time instead of choosing
     * a fresh cook/flight split.
     */
    flightMode?: "prefer-long" | "exact";
    /** Small positive margin so the grenade crosses the target just before detonation. */
    detonationBiasSeconds?: number;
}

export interface ForbiddenGrenadeThrowPlan {
    aimPoint: Vec2;
    landingPoint: Vec2;
    mouseLen: number;
    error: number;
    flightSeconds: number;
    impactSpeed: number;
    cookMs: number;
}

export interface ForbiddenIndirectShotPlan {
    kind: "ricochet" | "explode";
    aimPoint: Vec2;
    obstacle: ForbiddenObstacleSnapshot;
    totalDistance: number;
    score: number;
    /** Geometric closest-approach error after reflection. Zero for explosions. */
    missDistance?: number;
    /** Expected target centre when the reflected bullet reaches closest approach. */
    predictedTargetPoint?: Vec2;
    /** Complete incoming + outgoing flight time. */
    flightTime?: number;
}

export interface ForbiddenRicochetCandidate {
    aimPoint: Vec2;
    muzzlePoint: Vec2;
    reflectedDirection: Vec2;
    bulletPoint: Vec2;
    predictedTargetPoint: Vec2;
    incomingDistance: number;
    outgoingDistance: number;
    totalDistance: number;
    flightTime: number;
    missDistance: number;
    effectiveRadius: number;
    confidence: number;
    incidence: number;
    reflectedRange: number;
}

export interface ForbiddenExposedAimPoint {
    point: Vec2;
    /** 0 means only the outer edge is visible; 1 means the centre is visible. */
    exposure: number;
    offset: Vec2;
}

export interface ForbiddenPeekInterceptPlan {
    aimPoint: Vec2;
    targetCenter: Vec2;
    exposureTime: number;
    travelTime: number;
    /** Delay before firing so the projectile meets the target at first exposure. */
    fireIn: number;
    exposure: number;
    blockerId: number;
}

export interface ForbiddenGrenadeOpportunityInput {
    directLineClear: boolean;
    exposedFraction: number;
    enemyHealing: boolean;
    healRemainingMs: number;
    targetSpeed: number;
    distance: number;
    botHealth: number;
    imminentThreat: boolean;
    sinceLastThrowMs: number;
    estimatedArrivalMs: number;
    selfBlastDistance: number;
    behindHardCover: boolean;
    enemyWeaponReady: boolean;
    hasSafeLanding: boolean;
}

export interface ForbiddenGrenadeOpportunityDecision {
    use: boolean;
    score: number;
    reason:
        | "direct-window"
        | "cooldown"
        | "range"
        | "self-danger"
        | "under-fire"
        | "no-landing"
        | "heal-too-short"
        | "heal-punish"
        | "stationary-cover"
        | "poor-opportunity";
}

export interface ForbiddenCoverPressurePlan {
    point: Vec2;
    side: -1 | 1;
    score: number;
}

export interface ForbiddenGunLineDodgePlan {
    direction: Vec2;
    risk: number;
    side: -1 | 1;
}

/**
 * The server reflects every ordinary bullet on reflectBullets obstacles. This
 * is a map-surface rule, not a shotgun-only weapon feature.
 */
export function supportsForbiddenMapRicochet(input: {
    isGun: boolean;
    isLauncher: boolean;
    hasOnHitEffect: boolean;
}): boolean {
    return input.isGun && !input.isLauncher && !input.hasOnHitEffect;
}

export function shouldAllowForbiddenOmniscientGunfire(input: {
    difficulty: ForbiddenDifficulty;
    onScreen: boolean;
    legalIntentFresh: boolean;
}): boolean {
    return input.onScreen
        || (input.difficulty === "forbidden" && input.legalIntentFresh);
}

export function shouldForceForbiddenAttackWindow(input: {
    pathAllowsShot: boolean;
    targetDistance: number;
    engagementAgeMs: number;
    msSinceLastShot: number;
}): boolean {
    if (!input.pathAllowsShot) return false;
    if (input.targetDistance <= 18) return true;
    return input.engagementAgeMs >= 650 && input.msSinceLastShot >= 750;
}

/**
 * Combines the server movement intent with measured displacement. The measured
 * component prevents excessive lead when a player is holding a direction into
 * a wall, while the authoritative velocity keeps sudden direction changes
 * responsive.
 */
export function estimateForbiddenTargetVelocity(
    input: ForbiddenMotionEstimateInput,
): Vec2 {
    const dt = clamp(input.deltaSeconds, 0.008, 0.25);
    const authoritative = finiteVec(input.authoritativeVelocity)
        ? input.authoritativeVelocity
        : { x: 0, y: 0 };
    let candidate = { ...authoritative };

    if (input.previousPos && finiteVec(input.previousPos)) {
        const displacement = sub(input.currentPos, input.previousPos);
        const displacementLength = length(displacement);
        if (displacementLength <= 12) {
            const authoritativeSpeed = length(authoritative);
            // Forbidden contexts can arrive every 4-6 ms while authoritative
            // player positions update at a slower simulation cadence. Treating
            // those duplicate snapshots as measured zero velocity collapsed a
            // legitimate straight-line target to roughly 22% of its real speed,
            // producing the systematic under-lead visible in V42 recordings.
            // Only use displacement as a blocker signal after enough wall-clock
            // time has elapsed for one meaningful movement sample.
            const measurementReliable = dt >= 0.024;
            if (measurementReliable) {
                const measured = mul(displacement, 1 / dt);
                const measuredSpeed = length(measured);
                const likelyBlocked = authoritativeSpeed > 1.25
                    && measuredSpeed < authoritativeSpeed * 0.38;
                candidate = likelyBlocked
                    ? add(mul(measured, 0.68), mul(authoritative, 0.32))
                    : add(mul(authoritative, 0.76), mul(measured, 0.24));
            } else if (authoritativeSpeed <= 0.05 && input.previousVelocity) {
                // A genuine stop is still allowed to decay, but a non-zero
                // authoritative direction always wins over a too-young sample.
                candidate = mul(input.previousVelocity, 0.88);
            }
        }
    }

    if (!input.previousVelocity || !finiteVec(input.previousVelocity)) {
        return candidate;
    }
    const alpha = clamp(dt * 18, 0.32, 0.78);
    return add(
        mul(input.previousVelocity, 1 - alpha),
        mul(candidate, alpha),
    );
}

/** Advances the target to the expected server fire time before solving lead. */
export function compensateForbiddenContextAge(
    targetPos: Vec2,
    targetVelocity: Vec2,
    contextAgeSeconds: number,
    inputAndTickDelaySeconds = 0.015,
): Vec2 {
    const delay = clamp(
        contextAgeSeconds + inputAndTickDelaySeconds,
        0,
        0.18,
    );
    return add(targetPos, mul(targetVelocity, delay));
}

/**
 * Selects an empty or critically low firearm that should be restored. This is
 * deliberately separate from combat weapon selection: otherwise a loaded AWM
 * can permanently starve an empty Mosin because the loaded gun always wins the
 * immediate score comparison.
 */
export function chooseForbiddenReloadPlan(
    candidates: readonly ForbiddenReloadCandidate[],
    currentSlot: number,
): ForbiddenReloadPlan | null {
    let best: ForbiddenReloadCandidate | null = null;
    let bestPriority = Number.NEGATIVE_INFINITY;
    for (const candidate of candidates) {
        if (!candidate.reloadable || candidate.maxClip <= 0) continue;
        const empty = candidate.ammo <= 0;
        const critical = candidate.ammo < Math.min(2, candidate.maxClip);
        if (!empty && !critical) continue;
        const deficit = clamp((candidate.maxClip - candidate.ammo) / candidate.maxClip, 0, 1);
        const priority = candidate.score * 0.18
            + deficit * 110
            + (empty ? 95 : 0)
            + (candidate.slot === currentSlot ? 18 : 0);
        if (priority > bestPriority) {
            bestPriority = priority;
            best = candidate;
        }
    }
    if (!best) return null;
    return {
        slot: best.slot,
        // Shell-fed rifles/shotguns must not be abandoned after inserting one
        // round. Fill to at least two rounds and, when safe, to the full clip.
        targetAmmo: best.maxClip,
        urgent: best.ammo <= 0,
    };
}

/**
 * Keeps an empty-gun recovery deterministic. Once a reload has been requested
 * (or confirmed by the server), slot selection may not interrupt it. Otherwise
 * a loaded second gun is preferred; when both magazines are empty one stable
 * slot is selected for reloading instead of alternating between them.
 */
export function chooseForbiddenEmptyWeaponRecovery(
    input: ForbiddenEmptyWeaponRecoveryInput,
): ForbiddenEmptyWeaponRecovery | null {
    if (input.currentAmmo > 0) return null;
    if (input.reloading || input.reloadPending) {
        return {
            kind: "reload",
            slot: input.currentSlot,
            hold: input.reloading,
        };
    }
    if (input.otherAmmo > 0) {
        return { kind: "switch", slot: input.otherSlot };
    }
    if (input.currentReloadable) {
        return { kind: "reload", slot: input.currentSlot, hold: false };
    }
    if (input.otherReloadable) {
        return { kind: "switch", slot: input.otherSlot };
    }
    return { kind: "melee" };
}

/**
 * Plans a tactical airstrike response. Inventory alone never triggers an
 * automatic opening barrage. Multiple throws are committed only after hostile beacon
 * pressure is observed; otherwise one beacon may be used for a normal cover or
 * healing punish while the remainder is reserved. The duel opening is the one
 * exception: with enough beacons on the first seconds of a round the AI opens
 * with a short barrage instead of waiting to be bombed first.
 */
export function planForbiddenCounterStrobes(
    count: number,
    hostilePressure = 0,
    tacticalOpportunity = false,
    openingBarrage = false,
): ForbiddenCounterStrobePlan {
    const available = Math.max(0, Math.floor(count));
    if (available <= 0) {
        return { barrageCount: 0, reserveCount: available, carpet: false };
    }
    const pressure = Math.max(0, Math.floor(hostilePressure));
    let requested: number;
    if (openingBarrage && available >= 3) {
        requested = Math.min(3, available);
    } else if (pressure >= 2) {
        requested = Math.max(2, Math.min(4, pressure + 1));
    } else if (tacticalOpportunity) {
        requested = 1;
    } else {
        requested = 0;
    }
    const barrageCount = Math.min(available, requested);
    return {
        barrageCount,
        reserveCount: Math.max(0, available - barrageCount),
        carpet: barrageCount >= 2,
    };
}

const STROBE_STRIKE_DELAY_SECONDS = 2.5;
const STROBE_PLANE_TRAVEL_SECONDS = 0.32;
const STROBE_BOMB_FALL_SECONDS = 1.0;
const STROBE_IMPACT_DELAY_SECONDS = STROBE_STRIKE_DELAY_SECONDS
    + STROBE_PLANE_TRAVEL_SECONDS
    + STROBE_BOMB_FALL_SECONDS;
const STROBE_MAX_EFFECTIVE_MOUSE_LEN = 18 * 1.8;
const STROBE_THROW_SPEED = 25;
const STROBE_PLAYER_VELOCITY_MULTIPLIER = 0.6;
const STROBE_COVERAGE_RADIUS = 13;

/**
 * Replays the server's horizontal strobe drag until the first strike is
 * scheduled. This keeps the bot's throw-strength calculation grounded in the
 * real projectile model instead of using targetDistance * 8, which saturates
 * the input and routinely throws far beyond the intended point.
 */
export function simulateForbiddenStrobeDisplacement(
    mouseLen: number,
    aimDir: Vec2,
    throwerVelocity: Vec2 = { x: 0, y: 0 },
    duration = STROBE_STRIKE_DELAY_SECONDS,
): Vec2 {
    const direction = normalize(aimDir, { x: 1, y: 0 });
    const strength = (clamp(mouseLen, 0, STROBE_MAX_EFFECTIVE_MOUSE_LEN) / 15)
        * STROBE_THROW_SPEED;
    let velocity = add(
        mul(throwerVelocity, STROBE_PLAYER_VELOCITY_MULTIPLIER),
        mul(direction, strength),
    );
    let pos = { x: 0, y: 0 };
    let posZ = 0.5;
    let velocityZ = 5;
    let elapsed = 0;
    const fixedStep = 1 / 120;
    while (elapsed < duration - 1e-8) {
        const dt = Math.min(fixedStep, duration - elapsed);
        const drag = posZ !== 0 ? 1.2 : 2;
        velocity = mul(velocity, 1 / (1 + dt * drag));
        pos = add(pos, mul(velocity, dt));
        velocityZ -= 10 * dt;
        posZ = clamp(posZ + velocityZ * dt, 0, 5);
        elapsed += dt;
    }
    return pos;
}

/**
 * Converts a desired landing point into an ordinary aim direction and mouse
 * distance while compensating for the bot's current movement contribution.
 */
export function solveForbiddenStrobeThrow(
    botPos: Vec2,
    desiredLandingPoint: Vec2,
    botVelocity: Vec2,
): { aimPoint: Vec2; landingPoint: Vec2; mouseLen: number; error: number } {
    const desired = sub(desiredLandingPoint, botPos);
    const desiredDistance = length(desired);
    const unitMouseLen = 15 / STROBE_THROW_SPEED;
    const unitTravel = simulateForbiddenStrobeDisplacement(
        unitMouseLen,
        { x: 1, y: 0 },
        { x: 0, y: 0 },
    ).x;
    const travelCoefficient = Math.max(0.01, unitTravel);
    const requiredInitialVelocity = mul(desired, 1 / travelCoefficient);
    const throwVelocity = sub(
        requiredInitialVelocity,
        mul(botVelocity, STROBE_PLAYER_VELOCITY_MULTIPLIER),
    );
    const aimDir = normalize(throwVelocity, normalize(desired, { x: 1, y: 0 }));
    const requiredThrowSpeed = length(throwVelocity);
    const mouseLen = clamp(
        (requiredThrowSpeed * 15) / STROBE_THROW_SPEED,
        0,
        STROBE_MAX_EFFECTIVE_MOUSE_LEN,
    );
    const displacement = simulateForbiddenStrobeDisplacement(
        mouseLen,
        aimDir,
        botVelocity,
    );
    const landingPoint = add(botPos, displacement);
    const aimPoint = add(botPos, mul(aimDir, Math.max(8, desiredDistance)));
    return {
        aimPoint,
        landingPoint,
        mouseLen,
        error: length(sub(landingPoint, desiredLandingPoint)),
    };
}

const GRENADE_MAX_EFFECTIVE_MOUSE_LEN = 18 * 1.8;
const GRENADE_THROW_SPEED = 20;
const GRENADE_PLAYER_VELOCITY_MULTIPLIER = 0.6;
const GRENADE_FUSE_SECONDS = 4;
const GRENADE_MIN_FLIGHT_SECONDS = 0.68;
const GRENADE_MAX_AIRBURST_FLIGHT_SECONDS = 1.68;
const GRENADE_MIN_IMPACT_SPEED = 4.25;
const GRENADE_DEFAULT_DETONATION_BIAS_SECONDS = 0.055;

/** Matches WeaponManager.throwThrowable(): rotate({ x: 0.5, y: -1 }, aimAngle). */
function forbiddenGrenadeLaunchOffset(aimDir: Vec2): Vec2 {
    const direction = normalize(aimDir, { x: 1, y: 0 });
    return {
        x: 0.5 * direction.x + direction.y,
        y: 0.5 * direction.y - direction.x,
    };
}

/** Replays the ordinary frag/MIRV horizontal drag until its safe detonation window. */
export function simulateForbiddenGrenadeDisplacement(
    mouseLen: number,
    aimDir: Vec2,
    throwerVelocity: Vec2 = { x: 0, y: 0 },
    duration = 3.45,
): Vec2 {
    return simulateForbiddenGrenadeFlight(
        mouseLen,
        aimDir,
        throwerVelocity,
        duration,
    ).displacement;
}

export function simulateForbiddenGrenadeFlight(
    mouseLen: number,
    aimDir: Vec2,
    throwerVelocity: Vec2 = { x: 0, y: 0 },
    duration = 3.45,
): { displacement: Vec2; velocity: Vec2; speed: number } {
    const direction = normalize(aimDir, { x: 1, y: 0 });
    const strength = (clamp(mouseLen, 0, GRENADE_MAX_EFFECTIVE_MOUSE_LEN) / 15)
        * GRENADE_THROW_SPEED;
    let velocity = add(
        mul(throwerVelocity, GRENADE_PLAYER_VELOCITY_MULTIPLIER),
        mul(direction, strength),
    );
    let pos = { x: 0, y: 0 };
    let posZ = 0.5;
    let velocityZ = 5;
    let elapsed = 0;
    const fixedStep = 1 / 120;
    while (elapsed < duration - 1e-8) {
        const dt = Math.min(fixedStep, duration - elapsed);
        const drag = posZ !== 0 ? 1.2 : 2;
        velocity = mul(velocity, 1 / (1 + dt * drag));
        pos = add(pos, mul(velocity, dt));
        velocityZ -= 10 * dt;
        posZ = clamp(posZ + velocityZ * dt, 0, 5);
        elapsed += dt;
    }
    return {
        displacement: pos,
        velocity,
        speed: length(velocity),
    };
}

/**
 * Produces a bounded ordinary-input throw that lands outside the frag lethal
 * radius. Close walls on the first part of the arc are rejected because they
 * can bounce the grenade back at the thrower.
 */
export function solveForbiddenGrenadeThrow(
    input: ForbiddenGrenadeThrowInput,
): ForbiddenGrenadeThrowPlan | null {
    const margin = 2.5;
    const fallback = normalize(sub(input.desiredImpactPoint, input.botPos), { x: 1, y: 0 });
    let desired = {
        x: clamp(input.desiredImpactPoint.x, margin, Math.max(margin, input.mapWidth - margin)),
        y: clamp(input.desiredImpactPoint.y, margin, Math.max(margin, input.mapHeight - margin)),
    };
    const rawDistance = length(sub(desired, input.botPos));
    const desiredDistance = clamp(rawDistance, 14.5, 36);
    desired = add(input.botPos, mul(normalize(sub(desired, input.botPos), fallback), desiredDistance));
    desired = {
        x: clamp(desired.x, margin, Math.max(margin, input.mapWidth - margin)),
        y: clamp(desired.y, margin, Math.max(margin, input.mapHeight - margin)),
    };
    if (length(sub(desired, input.botPos)) < 13.5) return null;
    if (forbiddenPointBlocked(desired, input.layer, input.obstacles, 1.25)) return null;

    const exactFlight = input.flightMode === "exact";
    const preferredFlight = clamp(
        input.flightSeconds ?? GRENADE_MAX_AIRBURST_FLIGHT_SECONDS,
        GRENADE_MIN_FLIGHT_SECONDS,
        GRENADE_MAX_AIRBURST_FLIGHT_SECONDS,
    );
    const detonationBias = clamp(
        input.detonationBiasSeconds ?? GRENADE_DEFAULT_DETONATION_BIAS_SECONDS,
        0.02,
        0.12,
    );
    const candidates: number[] = [];
    if (exactFlight) {
        // A very small neighbourhood absorbs packet/tick quantisation while
        // still matching the immutable remaining fuse closely.
        for (const offset of [0, -0.015, 0.015, -0.03, 0.03]) {
            candidates.push(
                clamp(
                    preferredFlight + offset,
                    GRENADE_MIN_FLIGHT_SECONDS,
                    GRENADE_MAX_AIRBURST_FLIGHT_SECONDS,
                ),
            );
        }
    } else {
        // Search longest-to-shortest. A slower/longer useful flight means less
        // time spent cooking with the gun unavailable, reducing peek-timing
        // vulnerability without sacrificing the airburst.
        for (
            let flight = GRENADE_MAX_AIRBURST_FLIGHT_SECONDS;
            flight >= GRENADE_MIN_FLIGHT_SECONDS - 1e-6;
            flight -= 0.025
        ) {
            candidates.push(Number(flight.toFixed(4)));
        }
        candidates.push(preferredFlight);
    }

    let best: ForbiddenGrenadeThrowPlan | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    const visited = new Set<number>();
    for (const rawFlightSeconds of candidates) {
        const flightSeconds = Number(rawFlightSeconds.toFixed(4));
        if (visited.has(flightSeconds)) continue;
        visited.add(flightSeconds);
        const unitMouseLen = 15 / GRENADE_THROW_SPEED;
        const unitTravel = simulateForbiddenGrenadeDisplacement(
            unitMouseLen,
            { x: 1, y: 0 },
            { x: 0, y: 0 },
            flightSeconds,
        ).x;
        // Projectile origin is the throwing hand, not the player centre. The
        // offset itself rotates with aimDir, so solve it iteratively; two extra
        // passes are enough for this small (~1.12u) offset to converge.
        let aimDir = fallback;
        let mouseLen = 0;
        for (let iteration = 0; iteration < 3; iteration++) {
            const launchPoint = add(input.botPos, forbiddenGrenadeLaunchOffset(aimDir));
            const requiredInitialVelocity = mul(
                sub(desired, launchPoint),
                1 / Math.max(0.01, unitTravel),
            );
            const throwVelocity = sub(
                requiredInitialVelocity,
                mul(input.botVelocity, GRENADE_PLAYER_VELOCITY_MULTIPLIER),
            );
            aimDir = normalize(throwVelocity, fallback);
            mouseLen = clamp(
                (length(throwVelocity) * 15) / GRENADE_THROW_SPEED,
                0,
                GRENADE_MAX_EFFECTIVE_MOUSE_LEN,
            );
        }
        const flight = simulateForbiddenGrenadeFlight(
            mouseLen,
            aimDir,
            input.botVelocity,
            flightSeconds,
        );
        const launchPoint = add(input.botPos, forbiddenGrenadeLaunchOffset(aimDir));
        const landingPoint = add(launchPoint, flight.displacement);
        const landingDistance = length(sub(landingPoint, input.botPos));
        const error = length(sub(landingPoint, desired));
        if (landingDistance < 13.5 || error > 1.5) continue;
        if (flight.speed < GRENADE_MIN_IMPACT_SPEED) continue;
        if (forbiddenPointBlocked(landingPoint, input.layer, input.obstacles, 1.1)) continue;

        const blocker = firstForbiddenLineBlocker(
            input.botPos,
            landingPoint,
            input.layer,
            input.obstacles,
        );
        if (blocker) {
            const hitDistance = segmentHitDistance(input.botPos, landingPoint, blocker);
            if (hitDistance !== null && hitDistance < 7.5) continue;
        }
        // Leave a tiny server/network margin so detonation happens immediately
        // after crossing the predicted target.  The planner deliberately
        // rewards longer *useful* flight now: the old impact-speed reward chose
        // very short flights and forced the bot to expose itself while cooking
        // for more than three seconds.
        const cookMs = clamp(
            Math.round(
                (GRENADE_FUSE_SECONDS - flightSeconds - detonationBias) * 1000,
            ),
            100,
            3300,
        );
        const score = exactFlight
            ? -Math.abs(flightSeconds - preferredFlight) * 220
                - error * 18
                - Math.max(0, mouseLen - 31) * 0.25
            : flightSeconds * 26
                - error * 18
                - Math.abs(flightSeconds - preferredFlight) * 0.35
                - Math.max(0, mouseLen - 31) * 0.3
                + Math.min(2, flight.speed - GRENADE_MIN_IMPACT_SPEED) * 0.15;
        if (score > bestScore) {
            bestScore = score;
            best = {
                aimPoint: add(input.botPos, mul(aimDir, Math.max(8, desiredDistance))),
                landingPoint,
                mouseLen,
                error,
                flightSeconds,
                impactSpeed: flight.speed,
                cookMs,
            };
        }
    }
    return best;
}

/**
 * Re-solves a grenade that is already primed.  At this point the bot cannot
 * cancel the grenade and cannot regain fuse time; the only legal control is to
 * choose aim/mouse strength so the current remaining fuse becomes the flight
 * time to the predicted target.
 */
export function solveForbiddenPrimedGrenadeRelease(
    input: Omit<ForbiddenGrenadeThrowInput, "flightSeconds" | "flightMode"> & {
        remainingFuseSeconds: number;
    },
): ForbiddenGrenadeThrowPlan | null {
    const detonationBias = clamp(
        input.detonationBiasSeconds ?? GRENADE_DEFAULT_DETONATION_BIAS_SECONDS,
        0.02,
        0.12,
    );
    const flightSeconds = input.remainingFuseSeconds - detonationBias;
    if (
        flightSeconds < GRENADE_MIN_FLIGHT_SECONDS - 0.03
        || flightSeconds > GRENADE_MAX_AIRBURST_FLIGHT_SECONDS + 0.03
    ) {
        return null;
    }
    return solveForbiddenGrenadeThrow({
        ...input,
        flightSeconds,
        flightMode: "exact",
        detonationBiasSeconds: detonationBias,
    });
}

/**
 * Builds one member of a live strobe coverage barrage. Each call uses the current enemy
 * position and velocity, then selects the highest-value uncovered part of the
 * enemy's reachable space. Existing beacon centers are penalized so rapid
 * throws spread across escape routes instead of stacking on one location.
 */
export function planForbiddenStrobeCarpet(
    input: ForbiddenStrobeCarpetInput,
): ForbiddenStrobeThrowPlan | null {
    const mapWidth = Math.max(8, input.mapWidth);
    const mapHeight = Math.max(8, input.mapHeight);
    const margin = 2.5;
    const clampedEnemySpeed = Math.min(11, length(input.enemyVelocity));
    const motionDir = normalize(
        clampedEnemySpeed > 0.2 ? input.enemyVelocity : input.enemyDir,
        normalize(sub(input.enemyPos, input.botPos), { x: 1, y: 0 }),
    );
    const sideDir = perpendicular(motionDir);
    const momentumVelocity = clampedEnemySpeed > 0.001
        ? mul(motionDir, clampedEnemySpeed)
        : { x: 0, y: 0 };
    // Players rarely hold a perfectly straight line for the full airstrike
    // delay, so retain most—but not all—of current momentum.
    const predictedCenter = add(
        input.enemyPos,
        mul(momentumVelocity, STROBE_IMPACT_DELAY_SECONDS * 0.72),
    );
    const barrageSpread = clamp(
        1 + Math.max(0, input.barrageCount - 5) * 0.035,
        1,
        1.18,
    );
    const coverageSpread = (input.wideCoverage ? 1.28 : 1) * barrageSpread;
    const coverageRadius = STROBE_COVERAGE_RADIUS + (input.wideCoverage ? 7 : 0);
    const reachableRadius = clamp(7 + clampedEnemySpeed * 1.05, 8, 17) * coverageSpread;
    const sampleSpecs: Array<{ offset: Vec2; weight: number }> = [
        { offset: { x: 0, y: 0 }, weight: 4.4 },
        { offset: mul(motionDir, reachableRadius * 0.55), weight: 3.2 },
        { offset: mul(motionDir, -reachableRadius * 0.38), weight: 1.7 },
        { offset: mul(sideDir, reachableRadius * 0.62), weight: 2.8 },
        { offset: mul(sideDir, -reachableRadius * 0.62), weight: 2.8 },
        {
            offset: add(
                mul(motionDir, reachableRadius * 0.42),
                mul(sideDir, reachableRadius * 0.52),
            ),
            weight: 2.25,
        },
        {
            offset: add(
                mul(motionDir, reachableRadius * 0.42),
                mul(sideDir, -reachableRadius * 0.52),
            ),
            weight: 2.25,
        },
        { offset: sub(input.enemyPos, predictedCenter), weight: 1.25 },
    ];
    const samples = sampleSpecs.map((sample) => ({
        pos: {
            x: clamp(predictedCenter.x + sample.offset.x, margin, mapWidth - margin),
            y: clamp(predictedCenter.y + sample.offset.y, margin, mapHeight - margin),
        },
        weight: sample.weight,
    }));

    const candidatePoints: Vec2[] = [];
    const addCandidate = (point: Vec2): void => {
        candidatePoints.push({
            x: clamp(point.x, margin, mapWidth - margin),
            y: clamp(point.y, margin, mapHeight - margin),
        });
    };
    for (const sample of samples) addCandidate(sample.pos);
    addCandidate(add(predictedCenter, mul(sideDir, reachableRadius * 0.95)));
    addCandidate(add(predictedCenter, mul(sideDir, -reachableRadius * 0.95)));
    addCandidate(add(predictedCenter, mul(motionDir, reachableRadius * 0.9)));
    addCandidate(add(predictedCenter, mul(motionDir, -reachableRadius * 0.62)));
    if (input.wideCoverage) {
        addCandidate(add(
            predictedCenter,
            add(mul(motionDir, reachableRadius * 0.72), mul(sideDir, reachableRadius * 0.9)),
        ));
        addCandidate(add(
            predictedCenter,
            add(mul(motionDir, reachableRadius * 0.72), mul(sideDir, -reachableRadius * 0.9)),
        ));
        addCandidate(add(predictedCenter, mul(sideDir, reachableRadius * 1.2)));
        addCandidate(add(predictedCenter, mul(sideDir, -reachableRadius * 1.2)));
    }

    const minimumThrowDistance = 18;
    const maximumThrowDistance = 39;
    let best: ForbiddenStrobeThrowPlan | null = null;
    for (let candidateIndex = 0; candidateIndex < candidatePoints.length; candidateIndex++) {
        let desired = candidatePoints[candidateIndex];
        let fromBot = sub(desired, input.botPos);
        let throwDistance = length(fromBot);
        const fallbackDir = normalize(sub(predictedCenter, input.botPos), motionDir);
        if (throwDistance < minimumThrowDistance) {
            desired = add(input.botPos, mul(normalize(fromBot, fallbackDir), minimumThrowDistance));
        } else if (throwDistance > maximumThrowDistance) {
            desired = add(input.botPos, mul(normalize(fromBot, fallbackDir), maximumThrowDistance));
        }
        desired = {
            x: clamp(desired.x, margin, mapWidth - margin),
            y: clamp(desired.y, margin, mapHeight - margin),
        };
        fromBot = sub(desired, input.botPos);
        throwDistance = length(fromBot);
        if (throwDistance < 14.5 || forbiddenPointBlocked(desired, input.layer, input.obstacles, 1.4)) {
            continue;
        }

        const solved = solveForbiddenStrobeThrow(input.botPos, desired, input.botVelocity);
        if (solved.error > 3.25) continue;
        if (
            solved.landingPoint.x < margin
            || solved.landingPoint.y < margin
            || solved.landingPoint.x > mapWidth - margin
            || solved.landingPoint.y > mapHeight - margin
        ) continue;
        if (
            input.existingTargets.some(
                (existing) =>
                    length(sub(solved.landingPoint, existing.pos))
                        < (input.wideCoverage ? 10 : 5.5),
            )
        ) continue;

        let marginalCoverage = 0;
        for (const sample of samples) {
            const newCoverage = clamp(
                1 - length(sub(sample.pos, solved.landingPoint)) / coverageRadius,
                0,
                1,
            );
            let oldCoverage = 0;
            for (const existing of input.existingTargets) {
                oldCoverage = Math.max(
                    oldCoverage,
                    clamp(
                        1 - length(sub(sample.pos, existing.pos)) / coverageRadius,
                        0,
                        1,
                    ),
                );
            }
            marginalCoverage += sample.weight * Math.max(0, newCoverage - oldCoverage * 0.55);
        }

        let overlapPenalty = 0;
        for (const existing of input.existingTargets) {
            const separation = length(sub(solved.landingPoint, existing.pos));
            if (separation < coverageRadius * 1.3) {
                overlapPenalty += (coverageRadius * 1.3 - separation)
                    * (input.wideCoverage ? 0.56 : 0.38);
            }
        }
        const selfSafety = clamp((throwDistance - 15) / 12, 0, 1) * 3.5;
        const rangePreference = -Math.abs(throwDistance - 29) * 0.08;
        // Rotate otherwise-equal choices so a five-beacon opening does not
        // always favor the same side due to stable array ordering.
        const rotationTieBreak =
            ((candidateIndex + Math.max(0, input.throwIndex)) % Math.max(1, candidatePoints.length))
            * 0.0005;
        const coverageScore = marginalCoverage + selfSafety + rangePreference - overlapPenalty + rotationTieBreak;
        if (!best || coverageScore > best.coverageScore) {
            best = {
                aimPoint: solved.aimPoint,
                landingPoint: solved.landingPoint,
                coveragePoint: desired,
                mouseLen: solved.mouseLen,
                impactDelay: STROBE_IMPACT_DELAY_SECONDS,
                coverageScore,
            };
        }
    }

    if (!best || best.coverageScore < (input.wideCoverage ? -10 : 0.4)) return null;
    // Do not waste a beacon when even the closest reachable strike center is
    // far outside the enemy's projected escape space. The duel opening
    // barrage is the exception: the enemy is still approaching, so forward
    // strikes at max range create a moving curtain of fire.
    if (
        !input.openingBarrage
        && length(sub(best.landingPoint, predictedCenter)) > coverageRadius + reachableRadius + 5
    ) {
        return null;
    }
    return best;
}

/**
 * High-spread automatic guns gain far more accuracy by stopping before firing.
 * Incoming projectiles override this stance so the bot still prioritizes life.
 */
export function shouldUseAutomaticPrecisionStance(
    input: AutomaticPrecisionInput,
): boolean {
    if (!input.lineClear || input.imminentThreat) return false;
    if (input.fireMode !== "auto" && input.fireMode !== "burst") return false;
    if (input.bulletCount !== 1) return false;
    if (input.targetDistance < 12) return false;
    const movingSpread = Math.max(0, input.moveSpread);
    const baseSpread = Math.max(0, input.shotSpread);
    return movingSpread >= 2.5 && movingSpread + baseSpread >= 5;
}

export interface ForbiddenGunSlotCandidate {
    slot: number;
    loaded: boolean;
    reloadable: boolean;
    score: number;
}

/**
 * Selects a firearm slot without ever falling back to melee merely because
 * both magazines are temporarily empty. A reloadable empty firearm remains a
 * valid recovery target, preventing the bot from becoming stranded on fists.
 */
export function chooseForbiddenGunSlot(
    candidates: readonly ForbiddenGunSlotCandidate[],
    excludedSlot = -1,
): number {
    let bestSlot = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const candidate of candidates) {
        if (candidate.slot === excludedSlot) continue;
        if (!candidate.loaded && !candidate.reloadable) continue;
        const effectiveScore = candidate.score + (candidate.loaded ? 180 : -45);
        if (effectiveScore > bestScore) {
            bestScore = effectiveScore;
            bestSlot = candidate.slot;
        }
    }
    return bestSlot;
}

/**
 * Decides whether a normal weapon-slot input can produce an earlier legal next
 * shot. It never mutates weapon cooldowns, ammo or server combat state.
 */
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Vec2, scalar: number): Vec2 => ({ x: a.x * scalar, y: a.y * scalar });
const perpendicular = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const length = (a: Vec2): number => Math.hypot(a.x, a.y);
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const normalize = (a: Vec2, fallback: Vec2 = { x: 1, y: 0 }): Vec2 => {
    const len = length(a);
    return len > 1e-7 ? { x: a.x / len, y: a.y / len } : { ...fallback };
};
const finiteVec = (value: Vec2): boolean => Number.isFinite(value.x) && Number.isFinite(value.y);

function recoveredTargetPosition(
    targetPos: Vec2,
    slowedVelocity: Vec2,
    recoveredVelocity: Vec2,
    slowdownRemaining: number,
    time: number,
): Vec2 {
    const slowedTime = Math.min(Math.max(0, slowdownRemaining), Math.max(0, time));
    const recoveredTime = Math.max(0, time - slowedTime);
    return add(
        targetPos,
        add(
            mul(slowedVelocity, slowedTime),
            mul(recoveredVelocity, recoveredTime),
        ),
    );
}

/**
 * Solves |r + vt| = projectileSpeed * t for the earliest non-negative time
 * inside the requested interval. Keeping this analytic avoids the small but
 * systematic under-lead that fixed-point iteration can retain for fast
 * lateral targets and slower projectiles.
 */
function solveConstantVelocityInterceptTime(input: {
    relativePos: Vec2;
    targetVelocity: Vec2;
    projectileSpeed: number;
    minTime: number;
    maxTime: number;
}): number | null {
    const speed = Math.max(1e-4, input.projectileSpeed);
    const minTime = Math.max(0, input.minTime);
    const maxTime = Math.max(minTime, input.maxTime);
    const a = dot(input.targetVelocity, input.targetVelocity) - speed * speed;
    const b = 2 * dot(input.relativePos, input.targetVelocity);
    const c = dot(input.relativePos, input.relativePos);
    const roots: number[] = [];

    if (Math.abs(a) <= 1e-9) {
        if (Math.abs(b) > 1e-9) roots.push(-c / b);
    } else {
        const discriminant = b * b - 4 * a * c;
        if (discriminant >= -1e-8) {
            const sqrtDiscriminant = Math.sqrt(Math.max(0, discriminant));
            // Use both roots. In ordinary game ballistics one is negative, but
            // keeping both makes the helper correct for every tested geometry.
            roots.push(
                (-b - sqrtDiscriminant) / (2 * a),
                (-b + sqrtDiscriminant) / (2 * a),
            );
        }
    }

    const epsilon = 1e-7;
    const legal = roots
        .filter(
            (value) =>
                Number.isFinite(value)
                && value >= minTime - epsilon
                && value <= maxTime + epsilon,
        )
        .sort((left, right) => left - right);
    return legal.length > 0 ? clamp(legal[0], minTime, maxTime) : null;
}

/**
 * Intercept solver for sniper-shot movement slowdown. The target moves with
 * its currently reduced velocity until the authoritative slowdown timer ends,
 * then resumes its normal movement speed in the same input direction.
 */
export function solveInterceptWithSpeedRecovery(
    input: SpeedRecoveryInterceptInput,
): InterceptSolution {
    const speed = Math.max(1e-4, input.projectileSpeed);
    const maxTime = Math.max(0.05, input.maxTime ?? 2.8);
    const slowdownRemaining = clamp(input.slowdownRemaining, 0, maxTime);
    const relativeStart = sub(input.targetPos, input.shooterPos);

    // First solve the interval while the target is still slowed.
    let time = solveConstantVelocityInterceptTime({
        relativePos: relativeStart,
        targetVelocity: input.slowedVelocity,
        projectileSpeed: speed,
        minTime: 0,
        maxTime: slowdownRemaining,
    });

    // If no collision exists before recovery, rewrite the second segment as
    // targetBase + recoveredVelocity * t and solve using total flight time.
    if (time === null && slowdownRemaining < maxTime) {
        const recoveredBase = add(
            relativeStart,
            mul(
                sub(input.slowedVelocity, input.recoveredVelocity),
                slowdownRemaining,
            ),
        );
        time = solveConstantVelocityInterceptTime({
            relativePos: recoveredBase,
            targetVelocity: input.recoveredVelocity,
            projectileSpeed: speed,
            minTime: slowdownRemaining,
            maxTime,
        });
    }

    const exact = time !== null;
    if (time === null) {
        // The target can outrun the projectile or the solution can lie beyond
        // weapon range. Return a bounded pursuit point rather than NaN.
        time = clamp(length(relativeStart) / speed, 0, maxTime);
    }
    const predicted = recoveredTargetPosition(
        input.targetPos,
        input.slowedVelocity,
        input.recoveredVelocity,
        slowdownRemaining,
        time,
    );
    return {
        aimPoint: predicted,
        time,
        exact,
    };
}

function segmentHitDistance(
    from: Vec2,
    to: Vec2,
    obstacle: ForbiddenObstacleSnapshot,
): number | null {
    const hit = obstacle.collider.type === 0
        ? coldet.intersectSegmentCircle(
            from,
            to,
            obstacle.collider.pos,
            obstacle.collider.rad,
        )
        : coldet.intersectSegmentAabb(
            from,
            to,
            obstacle.collider.min,
            obstacle.collider.max,
        );
    return hit ? length(sub(hit.point, from)) : null;
}

export function firstForbiddenLineBlocker(
    from: Vec2,
    to: Vec2,
    layer: number,
    obstacles: readonly ForbiddenObstacleSnapshot[],
): ForbiddenObstacleSnapshot | null {
    let best: ForbiddenObstacleSnapshot | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const obstacle of obstacles) {
        if (
            obstacle.dead
            || !obstacle.collidable
            || obstacle.layer !== layer
            || obstacle.height < 0.25
        ) {
            continue;
        }
        const hitDistance = segmentHitDistance(from, to, obstacle);
        if (hitDistance !== null && hitDistance < bestDistance) {
            bestDistance = hitDistance;
            best = obstacle;
        }
    }
    return best;
}

export function isForbiddenLineClear(
    from: Vec2,
    to: Vec2,
    layer: number,
    obstacles: readonly ForbiddenObstacleSnapshot[],
    ignoredObstacleId = 0,
): boolean {
    for (const obstacle of obstacles) {
        if (obstacle.id === ignoredObstacleId) continue;
        if (
            obstacle.dead
            || !obstacle.collidable
            || obstacle.layer !== layer
            || obstacle.height < 0.25
        ) continue;
        if (segmentHitDistance(from, to, obstacle) !== null) return false;
    }
    return true;
}

/**
 * Samples the target body rather than treating the player as a single centre
 * point. This is important around sandbags: the centre may still be hidden
 * while a shoulder or leg is already a legal hit. The returned point is always
 * backed by the same authoritative obstacle colliders used by the server.
 */
export function findForbiddenExposedAimPoint(options: {
    shooterPos: Vec2;
    targetPos: Vec2;
    targetRadius?: number;
    layer: number;
    obstacles: readonly ForbiddenObstacleSnapshot[];
    preferredDirection?: Vec2 | null;
}): ForbiddenExposedAimPoint | null {
    const radius = Math.max(0.35, options.targetRadius ?? 1);
    const preferred = options.preferredDirection && length(options.preferredDirection) > 0.05
        ? normalize(options.preferredDirection)
        : null;
    const samples: Array<{ point: Vec2; offset: Vec2; ring: number }> = [
        { point: v2Copy(options.targetPos), offset: { x: 0, y: 0 }, ring: 0 },
    ];
    // Dense outer sampling catches the first visible pixels around an AABB
    // corner; inner rings prefer a deeper, more reliable hit when available.
    for (const ring of [0.28, 0.52, 0.74, 0.92]) {
        const count = ring >= 0.74 ? 32 : 24;
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i) / count;
            const offset = {
                x: Math.cos(angle) * radius * ring,
                y: Math.sin(angle) * radius * ring,
            };
            samples.push({
                point: add(options.targetPos, offset),
                offset,
                ring,
            });
        }
    }

    let best: ForbiddenExposedAimPoint | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const sample of samples) {
        if (
            !isForbiddenLineClear(
                options.shooterPos,
                sample.point,
                options.layer,
                options.obstacles,
            )
        ) continue;
        const motionBias = preferred
            ? dot(normalize(sample.offset, preferred), preferred) * sample.ring * 0.12
            : 0;
        // Prefer the centre, then the smallest offset that is actually exposed.
        const exposure = clamp(1 - sample.ring, 0.05, 1);
        const score = exposure * 100 + motionBias;
        if (score > bestScore) {
            bestScore = score;
            best = {
                point: v2Copy(sample.point),
                exposure,
                offset: v2Copy(sample.offset),
            };
        }
    }
    return best;
}

/**
 * Chooses a short breach point around the current blocker. It is used when an
 * opponent starts healing behind hard cover and no immediate direct, explosive
 * or ricochet shot is available. Candidate paths are collision checked both
 * from the bot to the point and from that point to the target body.
 */
export function chooseForbiddenCoverPressurePoint(options: {
    botPos: Vec2;
    enemyPos: Vec2;
    layer: number;
    blocker: ForbiddenObstacleSnapshot;
    obstacles: readonly ForbiddenObstacleSnapshot[];
    mapWidth: number;
    mapHeight: number;
    preferredSide?: -1 | 1;
}): ForbiddenCoverPressurePlan | null {
    const toEnemy = normalize(sub(options.enemyPos, options.botPos));
    const lateral = perpendicular(toEnemy);
    const preferredSide = options.preferredSide ?? 1;
    const sides: Array<-1 | 1> = [preferredSide, preferredSide === 1 ? -1 : 1];
    const blockerRadius = forbiddenObstacleRadius(options.blocker);
    let best: ForbiddenCoverPressurePlan | null = null;
    for (const side of sides) {
        for (const forwardOffset of [-1.5, 0.5, 2.5, 4.5]) {
            const point = add(
                options.blocker.pos,
                add(
                    mul(lateral, side * (blockerRadius + 2.1)),
                    mul(toEnemy, forwardOffset),
                ),
            );
            if (
                point.x < 1.4 || point.y < 1.4
                || point.x > options.mapWidth - 1.4
                || point.y > options.mapHeight - 1.4
                || forbiddenPointBlocked(point, options.layer, options.obstacles, 0.9)
                || !isForbiddenLineClear(
                    options.botPos,
                    point,
                    options.layer,
                    options.obstacles,
                )
            ) continue;
            const exposure = findForbiddenExposedAimPoint({
                shooterPos: point,
                targetPos: options.enemyPos,
                targetRadius: 1,
                layer: options.layer,
                obstacles: options.obstacles,
            });
            if (!exposure) continue;
            const travel = length(sub(point, options.botPos));
            const targetDistance = length(sub(options.enemyPos, point));
            const score = 260 - travel * 4.2 - Math.abs(targetDistance - 10) * 1.8
                + exposure.exposure * 55 + (side === preferredSide ? 9 : 0);
            if (!best || score > best.score) {
                best = { point: v2Copy(point), side, score };
            }
        }
    }
    return best;
}

/** A short stop-to-shoot settle for high-spread single-shot weapons. */
export function shouldUseSingleShotPrecisionBrake(input: {
    fireMode: string;
    fireDelay: number;
    moveSpread: number;
    shotSpread: number;
    targetDistance: number;
    lineClear: boolean;
    imminentThreat: boolean;
    botSpeed: number;
    enemyHealing: boolean;
    healRemainingMs: number;
    peekPrefire: boolean;
}): boolean {
    const singleShot = input.fireMode === "single" || input.fireDelay >= 0.34;
    if (
        !singleShot
        || !input.lineClear
        || input.targetDistance < 8.5
        || input.imminentThreat
        || input.botSpeed <= 0.38
        || input.peekPrefire
    ) return false;
    // Do not waste the last part of a healing punish window waiting to settle.
    if (input.enemyHealing && input.healRemainingMs <= 360) return false;
    const spreadBenefit = Math.max(0, input.moveSpread - input.shotSpread);
    return spreadBenefit >= 0.25 || input.targetDistance >= 18;
}

/**
 * Strategic grenade gate. The physical throw solver remains responsible for
 * the trajectory/cook, while this function decides whether giving up the gun
 * for a grenade is tactically justified.
 */
export function evaluateForbiddenGrenadeOpportunity(
    input: ForbiddenGrenadeOpportunityInput,
): ForbiddenGrenadeOpportunityDecision {
    if (input.sinceLastThrowMs < 2800) {
        return { use: false, score: -100, reason: "cooldown" };
    }
    if (input.distance < 12.5 || input.distance > 43.5) {
        return { use: false, score: -90, reason: "range" };
    }
    if (!input.hasSafeLanding) {
        return { use: false, score: -90, reason: "no-landing" };
    }
    if (input.selfBlastDistance < 9.2) {
        return { use: false, score: -120, reason: "self-danger" };
    }
    if (input.botHealth < 30 && input.imminentThreat) {
        return { use: false, score: -120, reason: "under-fire" };
    }
    if (
        input.directLineClear
        || input.exposedFraction >= 0.32
    ) {
        return { use: false, score: -80, reason: "direct-window" };
    }

    if (input.enemyHealing && input.behindHardCover) {
        // A grenade is useful when it arrives before the heal completes or
        // shortly after, because the forced displacement still cancels the use.
        if (
            input.healRemainingMs > 0
            && input.estimatedArrivalMs > input.healRemainingMs + 520
        ) {
            return { use: false, score: 5, reason: "heal-too-short" };
        }
        const score = 230 + clamp(input.healRemainingMs / 30, 0, 90)
            - input.estimatedArrivalMs * 0.025 - input.targetSpeed * 4;
        return { use: true, score, reason: "heal-punish" };
    }

    if (
        input.behindHardCover
        && input.targetSpeed <= 2.4
        && (!input.enemyWeaponReady || !input.imminentThreat)
    ) {
        const score = 135 - input.targetSpeed * 15 - input.distance * 0.5;
        return { use: score >= 95, score, reason: "stationary-cover" };
    }
    return { use: false, score: 0, reason: "poor-opportunity" };
}

function forbiddenObstacleRadius(obstacle: ForbiddenObstacleSnapshot): number {
    if (obstacle.collider.type === 0) return Math.max(0.5, obstacle.collider.rad);
    const width = obstacle.collider.max.x - obstacle.collider.min.x;
    const height = obstacle.collider.max.y - obstacle.collider.min.y;
    return Math.max(0.5, Math.hypot(width, height) * 0.5);
}

export function isForbiddenVolatileCoverUnsafe(
    obstacle: ForbiddenObstacleSnapshot,
    threat?: ForbiddenCoverThreat | null,
): boolean {
    const volatile = Boolean(obstacle.explosionType)
        || /(?:oil|fuel|propane|explosive|gas[_-]?(?:tank|can)|barrel_0?1)/i.test(
            obstacle.type,
        );
    if (!volatile || obstacle.dead || !obstacle.destructible) return false;

    const healthT = clamp(obstacle.healthT, 0, 1);
    if (healthT <= 0.5) return true;
    if (!threat) return false;

    const remainingHealth = Math.max(
        1,
        Number.isFinite(obstacle.health)
            ? obstacle.health
            : Math.max(1, obstacle.maxHealth) * healthT,
    );
    const damagePerShot = Math.max(0, threat.obstacleDamagePerShot);
    if (damagePerShot <= 0) return false;
    const shots = Math.max(1, Math.ceil(remainingHealth / damagePerShot));
    const breakSeconds = Math.max(0, shots - 1) * Math.max(0.035, threat.fireDelaySeconds);
    return shots === 1 || breakSeconds <= 0.72;
}

function forbiddenPointBlocked(
    point: Vec2,
    layer: number,
    obstacles: readonly ForbiddenObstacleSnapshot[],
    padding: number,
): boolean {
    for (const obstacle of obstacles) {
        if (
            obstacle.dead
            || !obstacle.collidable
            || obstacle.layer !== layer
            || obstacle.height < 0.25
        ) continue;
        if (obstacle.collider.type === 0) {
            if (length(sub(point, obstacle.collider.pos)) <= obstacle.collider.rad + padding) {
                return true;
            }
            continue;
        }
        if (
            point.x >= obstacle.collider.min.x - padding
            && point.x <= obstacle.collider.max.x + padding
            && point.y >= obstacle.collider.min.y - padding
            && point.y <= obstacle.collider.max.y + padding
        ) return true;
    }
    return false;
}

/**
 * Scores ordinary movement points around nearby obstacles. Reload and sniper
 * modes demand a blocked enemy ray; rifle mode prefers a shoulder-peek point;
 * melee mode uses cover only as an approach screen rather than camping behind
 * it indefinitely.
 */
export function chooseForbiddenCoverPosition(options: {
    botPos: Vec2;
    enemyPos: Vec2;
    layer: number;
    obstacles: readonly ForbiddenObstacleSnapshot[];
    mapWidth: number;
    mapHeight: number;
    mode: ForbiddenCoverMode;
    desiredRange: number;
    maxTravel?: number;
    enemyCoverThreat?: ForbiddenCoverThreat | null;
}): ForbiddenCoverChoice | null {
    const maxTravel = Math.max(4, options.maxTravel ?? 26);
    let best: ForbiddenCoverChoice | null = null;
    const fromEnemy = normalize(sub(options.botPos, options.enemyPos), { x: 1, y: 0 });
    for (const obstacle of options.obstacles) {
        if (
            obstacle.dead
            || !obstacle.collidable
            || obstacle.layer !== options.layer
            || obstacle.height < 0.25
        ) continue;
        if (isForbiddenVolatileCoverUnsafe(obstacle, options.enemyCoverThreat)) {
            continue;
        }
        const radius = forbiddenObstacleRadius(obstacle) + 1.45;
        const base = normalize(sub(obstacle.pos, options.enemyPos), fromEnemy);
        const directions = [
            base,
            normalize(add(base, mul(perpendicular(base), 0.55))),
            normalize(add(base, mul(perpendicular(base), -0.55))),
            normalize(add(base, mul(fromEnemy, 0.35))),
        ];
        for (const direction of directions) {
            const point = add(obstacle.pos, mul(direction, radius));
            if (
                point.x < 1.5 || point.y < 1.5
                || point.x > options.mapWidth - 1.5
                || point.y > options.mapHeight - 1.5
            ) continue;
            const travel = length(sub(point, options.botPos));
            if (travel > maxTravel) continue;
            const blocksEnemy = !isForbiddenLineClear(
                options.enemyPos,
                point,
                options.layer,
                options.obstacles,
            );
            const range = length(sub(point, options.enemyPos));
            const rangeError = Math.abs(range - options.desiredRange);
            let score = 120 - travel * 3.1 - rangeError * 1.25;
            if (blocksEnemy) score += options.mode === "reload" ? 210 : 95;
            else if (options.mode === "reload") score -= 240;
            if (options.mode === "sniper") score += range * 1.35;
            if (options.mode === "melee") score -= Math.max(0, range - 9) * 2.2;
            if (options.mode === "rifle" && blocksEnemy) score += 25;
            if (!best || score > best.score) {
                best = { point, obstacleId: obstacle.id, score, blocksEnemy };
            }
        }
    }
    return best;
}

/**
 * Combines several hostile strobes/bombs into one escape vector. Strobes are
 * treated as staggered strike corridors, so overlapping beacons increase the
 * danger instead of the last one overwriting the earlier plan.
 */
export function chooseForbiddenAirstrikeEscape(options: {
    botPos: Vec2;
    botLayer: number;
    botPlayerId: number;
    projectiles: readonly ForbiddenProjectileSnapshot[];
    mapWidth: number;
    mapHeight: number;
}): ForbiddenAirstrikeEscape | null {
    let vector = { x: 0, y: 0 };
    let danger = 0;
    let imminentIn = Number.POSITIVE_INFINITY;
    let hazards = 0;
    for (const projectile of options.projectiles) {
        if (projectile.layer !== options.botLayer) continue;
        const isStrobe = projectile.type === "strobe";
        const isBomb = projectile.type === "bomb_iron";
        // Own strobe lanes still damage the bot and must be respected. Ordinary
        // self-thrown grenades are handled by the separate projectile evasion
        // path and are not part of this airstrike planner.
        if (projectile.playerId === options.botPlayerId && !isStrobe) continue;
        if (!isStrobe && !isBomb) continue;
        if (
            isStrobe
            && projectile.strikeTime + Math.max(0, projectile.strikeDuration) < 0
        ) continue;
        const time = isStrobe
            ? clamp(projectile.strikeTime, 0, 8)
            : clamp(projectile.fuseTime, 0, 3);
        const predictionTime = Math.min(time, isStrobe ? 0.9 : 0.45);
        const center = add(projectile.pos, mul(projectile.velocity, predictionTime));
        const radius = Math.max(isStrobe ? 10 : 7, projectile.strikeRadius || 0);
        const dist = length(sub(options.botPos, center));
        // A thrown strobe already has a predictable landing corridor. Start
        // evacuating immediately instead of waiting until the aircraft is only
        // two seconds away. This applies to own and hostile beacons because
        // both can damage the bot.
        const activeSoon = time <= (isStrobe ? 8 : 1.8);
        if (!activeSoon || dist > radius + 20) continue;
        const timeWeight = isStrobe
            ? clamp((2.1 - time) / 2.1, 0.18, 1)
            : clamp((1.9 - time) / 1.9, 0.2, 1);
        const distanceWeight = clamp((radius + 20 - dist) / (radius + 20), 0, 1);
        const weight = timeWeight * distanceWeight * (isStrobe ? 1.35 : 1.8);
        vector = add(vector, mul(normalize(sub(options.botPos, center)), weight));
        danger += weight * 100;
        imminentIn = Math.min(imminentIn, time);
        hazards++;
    }
    if (hazards === 0 || danger < 4) return null;
    let direction = normalize(vector, { x: 1, y: 0 });
    const future = add(options.botPos, mul(direction, 8));
    if (
        future.x < 1.5 || future.y < 1.5
        || future.x > options.mapWidth - 1.5
        || future.y > options.mapHeight - 1.5
    ) {
        direction = normalize(sub(
            { x: options.mapWidth * 0.5, y: options.mapHeight * 0.5 },
            options.botPos,
        ));
    }
    return { direction, danger, imminentIn, hazards };
}

/**
 * Evades ordinary explosive projectiles regardless of ownership. A self-thrown
 * frag is just as lethal as an enemy frag, so excluding the bot's own playerId
 * creates avoidable suicides after a bounce or shortened throw.
 */
export function chooseForbiddenGrenadeEscape(options: {
    botPos: Vec2;
    botLayer: number;
    projectiles: readonly ForbiddenProjectileSnapshot[];
    mapWidth: number;
    mapHeight: number;
}): Vec2 | null {
    let vector = { x: 0, y: 0 };
    let weight = 0;
    for (const projectile of options.projectiles) {
        if (projectile.layer !== options.botLayer) continue;
        if (!/frag|mirv|martyr|potato/i.test(projectile.type)) continue;
        if (projectile.fuseTime < 0 || projectile.fuseTime > 2.35) continue;
        const predictionTime = clamp(projectile.fuseTime, 0, 0.9);
        const center = add(projectile.pos, mul(projectile.velocity, predictionTime));
        const dangerRadius = /mirv(?!_mini)/i.test(projectile.type)
            ? 15
            : /mirv_mini|martyr/i.test(projectile.type)
            ? 10
            : 13;
        const dist = length(sub(options.botPos, center));
        if (dist > dangerRadius + 5) continue;
        const timeWeight = clamp((2.45 - projectile.fuseTime) / 2.45, 0.15, 1);
        const distanceWeight = clamp((dangerRadius + 5 - dist) / (dangerRadius + 5), 0, 1);
        const danger = timeWeight * distanceWeight;
        vector = add(vector, mul(normalize(sub(options.botPos, center)), danger));
        weight += danger;
    }
    if (weight < 0.05) return null;
    let direction = normalize(vector, { x: 1, y: 0 });
    const future = add(options.botPos, mul(direction, 8));
    if (
        future.x < 1.5
        || future.y < 1.5
        || future.x > options.mapWidth - 1.5
        || future.y > options.mapHeight - 1.5
    ) {
        direction = normalize(
            sub(
                { x: options.mapWidth * 0.5, y: options.mapHeight * 0.5 },
                options.botPos,
            ),
        );
    }
    return direction;
}

function forbiddenObstacleSurfaceSamples(
    obstacle: ForbiddenObstacleSnapshot,
): Array<{ point: Vec2; normal: Vec2 }> {
    const samples: Array<{ point: Vec2; normal: Vec2 }> = [];
    if (obstacle.collider.type === 0) {
        const radius = Math.max(0.2, obstacle.collider.rad);
        // Dense enough that a one-unit player at normal duel distances is not
        // skipped between adjacent surface samples. The previous 72-point ring
        // produced visible low-confidence jumps on small stones.
        for (let i = 0; i < 120; i++) {
            const angle = (Math.PI * 2 * i) / 120;
            const normal = { x: Math.cos(angle), y: Math.sin(angle) };
            samples.push({
                point: add(obstacle.collider.pos, mul(normal, radius)),
                normal,
            });
        }
        return samples;
    }

    const { min, max } = obstacle.collider;
    for (let i = 1; i <= 39; i++) {
        const t = i / 40;
        const x = min.x + (max.x - min.x) * t;
        const y = min.y + (max.y - min.y) * t;
        samples.push({ point: { x, y: min.y }, normal: { x: 0, y: -1 } });
        samples.push({ point: { x, y: max.y }, normal: { x: 0, y: 1 } });
        samples.push({ point: { x: min.x, y }, normal: { x: -1, y: 0 } });
        samples.push({ point: { x: max.x, y }, normal: { x: 1, y: 0 } });
    }
    return samples;
}

/** Reproduces InputMsg.writeUnitVec/readUnitVec plus Player normalization. */
export function decodeForbiddenInputDirection(
    direction: Vec2,
    bitCount = 10,
): Vec2 {
    const bits = Math.max(2, Math.min(20, Math.floor(bitCount)));
    const min = -1.0001;
    const max = 1.0001;
    const range = (1 << bits) - 1;
    const quantize = (value: number): number => {
        const clamped = clamp(Number(value) || 0, min, max);
        const encoded = Math.floor(((clamped - min) / (max - min)) * range + 0.5);
        return min + (encoded / range) * (max - min);
    };
    return normalize({ x: quantize(direction.x), y: quantize(direction.y) });
}

/** Finds a direction that remains stable after the 10-bit wire round trip. */
export function stableForbiddenInputDirection(
    direction: Vec2,
    bitCount = 10,
): Vec2 {
    let stable = normalize(direction);
    for (let index = 0; index < 6; index += 1) {
        const decoded = decodeForbiddenInputDirection(stable, bitCount);
        if (length(sub(decoded, stable)) <= 1e-9) return decoded;
        stable = decoded;
    }
    return stable;
}

/**
 * Evaluates one surface point with the same vector reflection law used by the
 * server. Instead of comparing only ray angles, solve the closest approach
 * between the reflected bullet and the moving target. This rejects attractive
 * looking paths whose projectile would still pass outside the player collider.
 */
export function evaluateForbiddenRicochetCandidate(options: {
    from: Vec2;
    surfacePoint: Vec2;
    surfaceNormal: Vec2;
    enemyPos: Vec2;
    enemyVelocity: Vec2;
    bulletSpeed: number;
    bulletRange: number;
    targetRadius: number;
    spreadRadians?: number;
    barrelLength?: number;
    /** Server bullet range is divided by this value after one reflection. */
    reflectDistanceDecay?: number;
    /** Reflector collider enables authoritative 10-bit input re-tracing. */
    reflectorCollider?: ForbiddenObstacleSnapshot["collider"];
    inputDirectionBits?: number;
}): ForbiddenRicochetCandidate | null {
    const requestedSurfacePoint = options.surfacePoint;
    const centreToSurface = sub(requestedSurfacePoint, options.from);
    const centreDistance = length(centreToSurface);
    if (centreDistance < 1.25) return null;
    const requestedDirection = normalize(centreToSurface);
    const centreDirection = options.reflectorCollider
        ? stableForbiddenInputDirection(
            requestedDirection,
            options.inputDirectionBits ?? 10,
        )
        : requestedDirection;
    const barrelLength = clamp(
        Math.max(0, options.barrelLength ?? 0),
        0,
        Math.max(0, centreDistance - 0.3),
    );
    const muzzlePoint = add(options.from, mul(centreDirection, barrelLength));
    let surfacePoint = requestedSurfacePoint;
    let surfaceNormal = options.surfaceNormal;
    if (options.reflectorCollider) {
        const rayEnd = add(
            muzzlePoint,
            mul(centreDirection, Math.max(2, options.bulletRange)),
        );
        const hit = options.reflectorCollider.type === 0
            ? coldet.intersectSegmentCircle(
                muzzlePoint,
                rayEnd,
                options.reflectorCollider.pos,
                options.reflectorCollider.rad,
            )
            : coldet.intersectSegmentAabb(
                muzzlePoint,
                rayEnd,
                options.reflectorCollider.min,
                options.reflectorCollider.max,
            );
        if (!hit) return null;
        surfacePoint = hit.point;
        surfaceNormal = hit.normal;
    }
    const incomingVector = sub(surfacePoint, muzzlePoint);
    const incomingDistance = length(incomingVector);
    const speed = Math.max(1, options.bulletSpeed);
    if (incomingDistance < 1.25 || incomingDistance >= options.bulletRange * 0.97) {
        return null;
    }
    const incomingDirection = normalize(incomingVector);
    const normal = normalize(surfaceNormal);
    const incidence = dot(incomingDirection, normal);
    // Very shallow bounces amplify one-pixel surface and spread errors. They
    // generated most of the low-confidence plans in the uploaded recordings.
    if (incidence >= -0.12) return null;
    const reflectedDirection = normalize(
        sub(incomingDirection, mul(normal, 2 * incidence)),
    );

    const incomingTime = incomingDistance / speed;
    const targetAtBounce = add(
        options.enemyPos,
        mul(options.enemyVelocity, incomingTime),
    );
    const relativePosition = sub(targetAtBounce, surfacePoint);
    const relativeVelocity = sub(
        options.enemyVelocity,
        mul(reflectedDirection, speed),
    );
    const relativeSpeedSq = dot(relativeVelocity, relativeVelocity);
    if (relativeSpeedSq <= 1e-6) return null;
    const outgoingTime = -dot(relativePosition, relativeVelocity) / relativeSpeedSq;
    if (!Number.isFinite(outgoingTime) || outgoingTime <= 0) return null;

    const outgoingDistance = outgoingTime * speed;
    const totalDistance = incomingDistance + outgoingDistance;
    const reflectedRange = options.bulletRange
        / Math.max(1, options.reflectDistanceDecay ?? 1.5);
    // The server creates a new reflected bullet whose own range is decayed;
    // it does not grant the original remaining range. V42 accepted routes that
    // looked correct geometrically but expired before reaching the player.
    if (outgoingDistance > reflectedRange * 0.985) return null;

    const bulletPoint = add(
        surfacePoint,
        mul(reflectedDirection, outgoingDistance),
    );
    const flightTime = incomingTime + outgoingTime;
    const predictedTargetPoint = add(
        options.enemyPos,
        mul(options.enemyVelocity, flightTime),
    );
    const missDistance = length(sub(predictedTargetPoint, bulletPoint));
    const baseRadius = Math.max(0.42, options.targetRadius) * 0.92;
    const spreadRadius = Math.tan(Math.max(0, options.spreadRadians ?? 0))
        * totalDistance * 0.32;
    const effectiveRadius = Math.max(0.24, baseRadius - spreadRadius);
    if (missDistance > effectiveRadius) return null;

    const hitConfidence = clamp(1 - missDistance / effectiveRadius, 0, 1);
    // Do not spend a high-value shot on an edge-grazing mathematical route.
    // Surface sampling, network age and weapon spread all act in the same
    // direction, so reserve a meaningful collider margin.
    if (hitConfidence < 0.46) return null;
    const incidenceConfidence = clamp((-incidence - 0.1) / 0.9, 0, 1);
    return {
        aimPoint: options.reflectorCollider
            ? add(
                options.from,
                mul(centreDirection, Math.max(0.3, centreDistance - 0.025)),
            )
            : add(surfacePoint, mul(incomingDirection, -0.025)),
        muzzlePoint,
        reflectedDirection,
        bulletPoint,
        predictedTargetPoint,
        incomingDistance,
        outgoingDistance,
        totalDistance,
        flightTime,
        missDistance,
        effectiveRadius,
        confidence: hitConfidence * 0.78 + incidenceConfidence * 0.22,
        incidence,
        reflectedRange,
    };
}

/**
 * Searches for a legal indirect shot. Explosive props are preferred when the
 * enemy is inside their blast radius; reflective props are sampled using the
 * same vector reflection law as the server bullet simulation. Indestructible,
 * non-reflective cover is never selected as a target.
 */
export function chooseForbiddenIndirectShot(options: {
    from: Vec2;
    enemyPos: Vec2;
    layer: number;
    obstacles: readonly ForbiddenObstacleSnapshot[];
    bulletRange: number;
    bulletDamage: number;
    obstacleDamage: number;
    armorPiercing: boolean;
    stonePiercing: boolean;
    canRicochet: boolean;
    bulletSpeed?: number;
    enemyVelocity?: Vec2;
    targetRadius?: number;
    /** Current ballistic spread cone in radians. */
    spreadRadians?: number;
    barrelLength?: number;
    reflectDistanceDecay?: number;
    enemyHealing?: boolean;
    currentBlockerId?: number;
    /** Previous stable ricochet surface; used only as hysteresis, never legality. */
    preferredObstacleId?: number;
}): ForbiddenIndirectShotPlan | null {
    let best: ForbiddenIndirectShotPlan | null = null;
    const bulletRange = Math.max(0, options.bulletRange);
    const targetRadius = Math.max(0.45, options.targetRadius ?? 1);
    const obstacleShotDamage = Math.max(
        0,
        options.bulletDamage * Math.max(0, options.obstacleDamage),
    );
    for (const obstacle of options.obstacles) {
        if (
            obstacle.dead
            || !obstacle.collidable
            || obstacle.layer !== options.layer
            || obstacle.height < 0.25
        ) continue;

        if (
            obstacle.explosionType
            && obstacle.explosionRadius > 0
            && obstacle.destructible
            && (!obstacle.armorPlated || options.armorPiercing)
            && (!obstacle.stonePlated || options.stonePiercing)
            && obstacleShotDamage > 0.01
        ) {
            const enemyBlastDistance = length(sub(options.enemyPos, obstacle.pos));
            const selfBlastDistance = length(sub(options.from, obstacle.pos));
            const shotDistance = selfBlastDistance;
            const shots = Math.ceil(Math.max(1, obstacle.health) / obstacleShotDamage);
            const protectsBot = assessCoverProtection({
                botPos: options.from,
                enemyPos: options.enemyPos,
                coverPos: obstacle.pos,
                coverRadius: forbiddenObstacleRadius(obstacle),
            }).protectsBot;
            if (
                enemyBlastDistance <= obstacle.explosionRadius * 0.98 + targetRadius * 0.35
                && selfBlastDistance >= obstacle.explosionRadius + 2.4
                && shotDistance <= bulletRange + 0.25
                && shots <= 7
                && !protectsBot
                && isForbiddenLineClear(
                    options.from,
                    obstacle.pos,
                    options.layer,
                    options.obstacles,
                    obstacle.id,
                )
            ) {
                const score = 620
                    - shots * 42
                    - enemyBlastDistance * 5.5
                    - shotDistance * 0.7
                    + obstacle.explosionRadius * 7
                    + (options.enemyHealing ? 95 : 0)
                    + (obstacle.id === options.currentBlockerId ? 28 : 0);
                if (!best || score > best.score) {
                    best = {
                        kind: "explode",
                        aimPoint: v2Copy(obstacle.pos),
                        obstacle,
                        totalDistance: shotDistance,
                        score,
                    };
                }
            }
        }

        if (!options.canRicochet || !obstacle.reflectBullets) continue;
        const surfaceSamples = forbiddenObstacleSurfaceSamples(obstacle);
        for (const sample of surfaceSamples) {
            const candidate = evaluateForbiddenRicochetCandidate({
                from: options.from,
                surfacePoint: sample.point,
                surfaceNormal: sample.normal,
                enemyPos: options.enemyPos,
                enemyVelocity: options.enemyVelocity ?? { x: 0, y: 0 },
                bulletSpeed: Math.max(1, options.bulletSpeed ?? 1000),
                bulletRange,
                targetRadius,
                spreadRadians: options.spreadRadians,
                barrelLength: options.barrelLength,
                reflectDistanceDecay: options.reflectDistanceDecay,
                reflectorCollider: obstacle.collider,
                inputDirectionBits: 10,
            });
            if (!candidate) continue;

            const incomingDirection = normalize(sub(sample.point, options.from));
            const incomingEnd = add(sample.point, mul(incomingDirection, -0.075));
            if (
                !isForbiddenLineClear(
                    candidate.muzzlePoint,
                    incomingEnd,
                    options.layer,
                    options.obstacles,
                    obstacle.id,
                )
            ) continue;

            const outgoingStart = add(
                sample.point,
                mul(candidate.reflectedDirection, 0.09),
            );
            if (
                !isForbiddenLineClear(
                    outgoingStart,
                    candidate.bulletPoint,
                    options.layer,
                    options.obstacles,
                    obstacle.id,
                )
            ) continue;

            const score = 390 - candidate.totalDistance * 1.05
                + candidate.confidence * 210
                - candidate.missDistance * 90
                + (options.enemyHealing ? 120 : 0)
                + (obstacle.id === options.currentBlockerId ? 38 : 0)
                + (obstacle.id === options.preferredObstacleId ? 62 : 0);
            if (!best || score > best.score) {
                best = {
                    kind: "ricochet",
                    aimPoint: candidate.aimPoint,
                    obstacle,
                    totalDistance: candidate.totalDistance,
                    score,
                    missDistance: candidate.missDistance,
                    predictedTargetPoint: candidate.predictedTargetPoint,
                    flightTime: candidate.flightTime,
                };
            }
        }
    }
    return best;
}

/**
 * Picks a stable lateral escape from an enemy's current gun line. This is
 * proactive aim-line evasion, separate from reactive bullet dodging.
 */
export function chooseForbiddenGunLineDodge(options: {
    botPos: Vec2;
    enemyPos: Vec2;
    enemyDir: Vec2;
    enemyRange: number;
    enemyReady: boolean;
    spreadRadians?: number;
    layer: number;
    obstacles: readonly ForbiddenObstacleSnapshot[];
    mapWidth: number;
    mapHeight: number;
    preferredSide?: -1 | 1;
    /** Ordinary player movement speed available before the predicted shot arrives. */
    botMoveSpeed?: number;
    /** Enemy bullet speed. Supplying it enables time-feasibility rejection. */
    enemyProjectileSpeed?: number;
    reactionSeconds?: number;
}): ForbiddenGunLineDodgePlan | null {
    const currentRisk = enemyAimThreat({
        shooterPos: options.enemyPos,
        shooterDir: options.enemyDir,
        targetPos: options.botPos,
        weaponRange: options.enemyRange,
        weaponReady: options.enemyReady,
        spreadRadians: options.spreadRadians,
    });
    if (currentRisk < 0.08) return null;

    const shotDistance = length(sub(options.botPos, options.enemyPos));
    const projectileSpeed = Math.max(1, options.enemyProjectileSpeed ?? 1000);
    const reactionSeconds = clamp(options.reactionSeconds ?? 0.055, 0, 0.25);
    const impactSeconds = shotDistance / projectileSpeed;
    const availableTravel = Math.max(0, impactSeconds - reactionSeconds)
        * Math.max(0, options.botMoveSpeed ?? 1000);
    // When authoritative movement and projectile speeds are supplied, reject a
    // theatrical sidestep that cannot leave the aim corridor before impact.
    if (options.botMoveSpeed !== undefined && options.enemyProjectileSpeed !== undefined && availableTravel < 1.15) {
        return null;
    }

    const aimDir = normalize(options.enemyDir, normalize(sub(options.botPos, options.enemyPos)));
    const lateral = perpendicular(aimDir);
    const away = normalize(sub(options.botPos, options.enemyPos), mul(aimDir, -1));
    const preferred = options.preferredSide ?? 1;
    const sides: Array<-1 | 1> = [preferred, preferred === 1 ? -1 : 1];
    let best: ForbiddenGunLineDodgePlan | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const side of sides) {
        const direction = normalize(add(mul(lateral, side), mul(away, 0.22)));
        const candidateSteps = [2.25, 3.5, 4.5, 6.5, 8.5].filter(
            (distanceStep) =>
                options.botMoveSpeed === undefined
                || options.enemyProjectileSpeed === undefined
                || distanceStep <= availableTravel + 0.25,
        );
        for (const distanceStep of candidateSteps) {
            const target = add(options.botPos, mul(direction, distanceStep));
            if (
                target.x < 1.2 || target.y < 1.2
                || target.x > options.mapWidth - 1.2
                || target.y > options.mapHeight - 1.2
                || forbiddenPointBlocked(target, options.layer, options.obstacles, 0.95)
                || !isForbiddenLineClear(
                    options.botPos,
                    target,
                    options.layer,
                    options.obstacles,
                )
            ) continue;
            const futureRisk = enemyAimThreat({
                shooterPos: options.enemyPos,
                shooterDir: options.enemyDir,
                targetPos: target,
                weaponRange: options.enemyRange,
                weaponReady: options.enemyReady,
                spreadRadians: options.spreadRadians,
            });
            const score = (currentRisk - futureRisk) * 240
                + distanceStep * 1.5
                + (side === preferred ? 8 : 0);
            const feasibleRiskReduction = futureRisk <= currentRisk * 0.58 || currentRisk - futureRisk >= 0.24;
            if (feasibleRiskReduction && score > bestScore) {
                bestScore = score;
                best = { direction, risk: currentRisk, side };
            }
        }
    }
    return best;
}

const v2Copy = (value: Vec2): Vec2 => ({ x: value.x, y: value.y });

/**
 * Classifies the first object on the predicted shot path. The caller can hold,
 * destroy cheap cover, or detonate an explosive obstacle without ever firing
 * into an indestructible wall by mistake.
 */
export function evaluateForbiddenShotPath(
    input: ForbiddenShotPathInput,
): ForbiddenShotPathDecision {
    const blocker = firstForbiddenLineBlocker(
        input.from,
        input.to,
        input.layer,
        input.obstacles,
    );
    if (!blocker) return { kind: "clear" };

    const coverRadius = blocker.collider.type === 0
        ? Math.max(0.2, blocker.collider.rad)
        : Math.max(
            0.2,
            Math.hypot(
                blocker.collider.max.x - blocker.collider.min.x,
                blocker.collider.max.y - blocker.collider.min.y,
            ) * 0.5,
        );
    if (
        assessCoverProtection({
            botPos: input.from,
            enemyPos: input.enemyPos,
            coverPos: blocker.pos,
            coverRadius,
        }).protectsBot
    ) {
        return { kind: "hold", blocker };
    }

    if (!blocker.destructible) return { kind: "hold", blocker };
    if (blocker.armorPlated && !input.armorPiercing) return { kind: "hold", blocker };
    if (blocker.stonePlated && !input.stonePiercing) return { kind: "hold", blocker };

    const obstacleShotDamage = Math.max(
        0,
        input.bulletDamage * Math.max(0, input.obstacleDamage),
    );
    if (obstacleShotDamage <= 0.01) return { kind: "hold", blocker };

    if (
        blocker.explosionType
        && blocker.explosionRadius > 0
        && length(sub(input.enemyPos, blocker.pos)) <= blocker.explosionRadius * 0.92
    ) {
        return { kind: "explode", blocker, aimPoint: blocker.pos };
    }

    const shots = Math.ceil(Math.max(0, blocker.health) / obstacleShotDamage);
    const lowHealthEnemy = input.enemyHealth <= 36;
    const coverPressureLimit = input.enemyUsingCover
        ? (Number(input.targetDistance ?? 0) <= 16 ? 8 : 6)
        : 3;
    const worthDestroying = shots <= coverPressureLimit
        || (shots <= coverPressureLimit + 2 && (input.enemyHealing || lowHealthEnemy))
        || blocker.healthT <= 0.42;
    if (worthDestroying) return { kind: "destroy", blocker, shots };
    return { kind: "wait-peek", blocker };
}

/** Returns a 0..1 risk that the enemy's current aim ray covers the bot. */
export function enemyAimThreat(input: AimThreatInput): number {
    if (!input.weaponReady || input.weaponRange <= 0) return 0;
    const aim = normalize(input.shooterDir);
    const relative = sub(input.targetPos, input.shooterPos);
    const forward = dot(relative, aim);
    if (forward <= 0 || forward > input.weaponRange) return 0;
    const closest = add(input.shooterPos, mul(aim, forward));
    const missDistance = length(sub(input.targetPos, closest));
    const coneRadius = Math.max(
        1.05,
        Math.tan(Math.max(0, input.spreadRadians ?? 0)) * forward + 0.8,
    );
    return clamp(1 - missDistance / coneRadius, 0, 1);
}

/**
 * Finds the first future point where a line from the bot to the moving target
 * no longer crosses the current cover. Used to time a bullet for the instant a
 * player starts to expose around an edge.
 */
export function solvePeekInterceptWindow(options: {
    shooterPos: Vec2;
    targetPos: Vec2;
    targetRadius?: number;
    slowedVelocity: Vec2;
    recoveredVelocity: Vec2;
    slowdownRemaining: number;
    projectileSpeed: number;
    layer: number;
    obstacles: readonly ForbiddenObstacleSnapshot[];
    currentBlockerId: number;
    horizon?: number;
    maxFireLead?: number;
}): ForbiddenPeekInterceptPlan | null {
    const horizon = Math.max(0.1, options.horizon ?? 1.35);
    const maxFireLead = Math.max(0.04, options.maxFireLead ?? 0.24);
    let best: ForbiddenPeekInterceptPlan | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let t = 0.02; t <= horizon; t += 0.015) {
        const targetCenter = recoveredTargetPosition(
            options.targetPos,
            options.slowedVelocity,
            options.recoveredVelocity,
            options.slowdownRemaining,
            t,
        );
        const exposed = findForbiddenExposedAimPoint({
            shooterPos: options.shooterPos,
            targetPos: targetCenter,
            targetRadius: options.targetRadius ?? 1,
            layer: options.layer,
            obstacles: options.obstacles,
            preferredDirection: options.recoveredVelocity,
        });
        if (!exposed) continue;
        const currentBlocker = firstForbiddenLineBlocker(
            options.shooterPos,
            options.targetPos,
            options.layer,
            options.obstacles,
        );
        if (currentBlocker && currentBlocker.id !== options.currentBlockerId) continue;
        const travelTime = length(sub(exposed.point, options.shooterPos))
            / Math.max(1e-4, options.projectileSpeed);
        const fireIn = t - travelTime;
        // Negative means the shot fired now arrives just after first exposure.
        // A small negative tolerance is preferable to missing the whole peek.
        if (fireIn < -0.055 || fireIn > maxFireLead) continue;
        const timingError = Math.abs(fireIn);
        const score = 240 - timingError * 800 - t * 26 + exposed.exposure * 42;
        if (score > bestScore) {
            bestScore = score;
            best = {
                aimPoint: v2Copy(exposed.point),
                targetCenter: v2Copy(targetCenter),
                exposureTime: t,
                travelTime,
                fireIn,
                exposure: exposed.exposure,
                blockerId: options.currentBlockerId,
            };
        }
    }
    return best;
}

/** Backward-compatible exposure prediction used by older smoke tests. */
export function solvePeekExposure(options: {
    shooterPos: Vec2;
    targetPos: Vec2;
    slowedVelocity: Vec2;
    recoveredVelocity: Vec2;
    slowdownRemaining: number;
    projectileSpeed: number;
    layer: number;
    obstacles: readonly ForbiddenObstacleSnapshot[];
    currentBlockerId: number;
    horizon?: number;
}): InterceptSolution | null {
    const plan = solvePeekInterceptWindow({
        ...options,
        targetRadius: 1,
    });
    return plan
        ? { aimPoint: plan.aimPoint, time: plan.exposureTime, exact: true }
        : null;
}

/**
 * Returns true after several very short visible windows. This is the common
 * fake-peek pattern where the opponent tries to consume a slow weapon shot and
 * hides before the projectile arrives.
 */
export function detectPeekBait(
    samples: readonly PeekBaitSample[],
    shortWindowMs = 175,
): boolean {
    if (samples.length < 5) return false;
    let shortExposures = 0;
    let visibleSince = -1;
    for (const sample of samples) {
        if (sample.visible && visibleSince < 0) visibleSince = sample.timestamp;
        if (!sample.visible && visibleSince >= 0) {
            const duration = sample.timestamp - visibleSince;
            if (duration >= 0 && duration <= shortWindowMs) shortExposures++;
            visibleSince = -1;
        }
    }
    return shortExposures >= 2;
}

/**
 * Detects lateral reversals that repeatedly occur shortly after the bot fires.
 * The score decays over time and rises only when the reversal lands inside the
 * plausible reaction window, avoiding false positives from ordinary strafing.
 */
export function updateCadenceEvasionScore(
    input: CadenceEvasionInput,
): number {
    let score = Math.max(0, input.score - Math.max(0, input.elapsedMs) / 2600);
    const reversed = input.currentLateralSign !== 0
        && input.previousLateralSign !== 0
        && input.currentLateralSign !== input.previousLateralSign;
    if (!reversed) return score;
    if (input.msSinceLastShot >= 35 && input.msSinceLastShot <= 285) {
        score += 1;
    } else {
        score -= 0.2;
    }
    return clamp(score, 0, 6);
}

/**
 * Analytic constant-velocity intercept. Falls back to a bounded iterative lead
 * when the quadratic has no positive solution (target too fast / degenerate).
 */
export function solveIntercept(
    shooterPos: Vec2,
    targetPos: Vec2,
    targetVelocity: Vec2,
    projectileSpeed: number,
    maxTime = 2.5,
): InterceptSolution {
    const speed = Math.max(1e-4, projectileSpeed);
    const relative = sub(targetPos, shooterPos);
    const a = dot(targetVelocity, targetVelocity) - speed * speed;
    const b = 2 * dot(relative, targetVelocity);
    const c = dot(relative, relative);

    let time = Number.NaN;
    if (Math.abs(a) < 1e-7) {
        if (Math.abs(b) > 1e-7) {
            const linear = -c / b;
            if (linear > 0) time = linear;
        }
    } else {
        const discriminant = b * b - 4 * a * c;
        if (discriminant >= 0) {
            const root = Math.sqrt(discriminant);
            const t1 = (-b - root) / (2 * a);
            const t2 = (-b + root) / (2 * a);
            const positive = [t1, t2].filter((value) => Number.isFinite(value) && value > 0);
            if (positive.length > 0) time = Math.min(...positive);
        }
    }

    const exact = Number.isFinite(time) && time > 0 && time <= maxTime;
    if (!exact) {
        let predicted = { ...targetPos };
        time = clamp(length(relative) / speed, 0, maxTime);
        for (let i = 0; i < 4; i++) {
            predicted = add(targetPos, mul(targetVelocity, time));
            time = clamp(length(sub(predicted, shooterPos)) / speed, 0, maxTime);
        }
        return { aimPoint: predicted, time, exact: false };
    }

    return {
        aimPoint: add(targetPos, mul(targetVelocity, time)),
        time,
        exact: true,
    };
}

export function analyzeBulletThreats(
    botPos: Vec2,
    botRadius: number,
    botLayer: number,
    bullets: readonly ForbiddenBulletSnapshot[],
    botPlayerId: number,
    horizonSeconds = 0.65,
): BulletThreat[] {
    const threats: BulletThreat[] = [];
    for (const bullet of bullets) {
        if (bullet.playerId === botPlayerId || bullet.layer !== botLayer) continue;
        const speed = Math.max(0, bullet.speed);
        if (speed <= 0 || bullet.remainingDistance <= 0) continue;
        const velocity = mul(normalize(bullet.dir), speed);
        const relative = sub(bullet.pos, botPos);
        const speedSquared = dot(velocity, velocity);
        if (speedSquared <= 1e-7) continue;
        const maxTravelTime = bullet.remainingDistance / speed;
        const closestTime = clamp(-dot(relative, velocity) / speedSquared, 0, Math.min(horizonSeconds, maxTravelTime));
        const impactPoint = add(bullet.pos, mul(velocity, closestTime));
        const closestDistance = length(sub(impactPoint, botPos));
        const safetyRadius = botRadius + 1.0;
        if (closestDistance > safetyRadius + 4.5) continue;
        const distanceDanger = clamp((safetyRadius + 4.5 - closestDistance) / (safetyRadius + 4.5), 0, 1);
        const timeDanger = 1 - clamp(closestTime / Math.max(0.05, horizonSeconds), 0, 1);
        const danger = distanceDanger * 80 + timeDanger * 35 + Math.max(0, bullet.damage) * 0.65;
        threats.push({ bullet, closestTime, closestDistance, impactPoint, danger });
    }
    return threats.sort((a, b) => b.danger - a.danger);
}

/**
 * Samples 24 movement directions and scores the resulting future positions
 * against all incoming bullet rays. This does not alter movement speed; it only
 * chooses ordinary digital movement inputs.
 */
export function chooseDodgeDirection(options: {
    botPos: Vec2;
    botRadius: number;
    botLayer: number;
    botPlayerId: number;
    botMoveSpeed: number;
    bullets: readonly ForbiddenBulletSnapshot[];
    targetPos?: Vec2 | null;
    mapWidth: number;
    mapHeight: number;
    preferredRange?: number;
    obstacles?: readonly ForbiddenObstacleSnapshot[];
}): DodgeSolution | null {
    const threats = analyzeBulletThreats(
        options.botPos,
        options.botRadius,
        options.botLayer,
        options.bullets,
        options.botPlayerId,
    );
    if (threats.length === 0) return null;

    const reactionSeconds = 0.035;
    const safetyRadius = options.botRadius + 1.02;
    const speed = Math.max(0, options.botMoveSpeed);
    const obstacles = options.obstacles ?? [];
    const directions: Vec2[] = [];
    for (let i = 0; i < 48; i++) {
        const angle = (Math.PI * 2 * i) / 48;
        directions.push({ x: Math.cos(angle), y: Math.sin(angle) });
    }

    const closestOnSegment = (
        relativeStart: Vec2,
        relativeVelocity: Vec2,
        duration: number,
    ): number => {
        if (duration <= 0) return length(relativeStart);
        const velocitySq = dot(relativeVelocity, relativeVelocity);
        const time = velocitySq <= 1e-8
            ? 0
            : clamp(-dot(relativeStart, relativeVelocity) / velocitySq, 0, duration);
        return length(add(relativeStart, mul(relativeVelocity, time)));
    };

    const evaluate = (direction: Vec2): {
        danger: number;
        minimumSeparation: number;
        directHits: number;
        blocked: boolean;
    } => {
        let danger = 0;
        let minimumSeparation = Number.POSITIVE_INFINITY;
        let directHits = 0;
        let blocked = false;
        const botVelocity = mul(normalize(direction, { x: 0, y: 0 }), speed);

        // A direction is usable only when the complete movement corridor is
        // clear. Sampling includes the maximum bullet horizon and short-term
        // intermediate positions so the bot cannot "dodge" into a wall.
        if (dot(direction, direction) > 1e-8) {
            for (const sampleTime of [0.06, 0.1, 0.16, 0.24, 0.34, 0.48, 0.65]) {
                const moveTime = Math.max(0, sampleTime - reactionSeconds);
                const candidate = add(options.botPos, mul(botVelocity, moveTime));
                if (
                    candidate.x < 1.5
                    || candidate.y < 1.5
                    || candidate.x > options.mapWidth - 1.5
                    || candidate.y > options.mapHeight - 1.5
                    || forbiddenPointBlocked(
                        candidate,
                        options.botLayer,
                        obstacles,
                        options.botRadius + 0.16,
                    )
                ) {
                    blocked = true;
                    break;
                }
            }
        }
        if (blocked) {
            return {
                danger: Number.POSITIVE_INFINITY,
                minimumSeparation: 0,
                directHits: Number.MAX_SAFE_INTEGER,
                blocked: true,
            };
        }

        for (const threat of threats) {
            const bulletVelocity = mul(
                normalize(threat.bullet.dir),
                Math.max(0, threat.bullet.speed),
            );
            const maxTime = Math.min(
                0.72,
                threat.bullet.remainingDistance / Math.max(0.001, threat.bullet.speed),
            );
            const preReactionDuration = Math.min(reactionSeconds, maxTime);
            const initialRelative = sub(threat.bullet.pos, options.botPos);
            let closest = closestOnSegment(
                initialRelative,
                bulletVelocity,
                preReactionDuration,
            );
            if (maxTime > reactionSeconds) {
                const bulletAtReaction = add(
                    threat.bullet.pos,
                    mul(bulletVelocity, reactionSeconds),
                );
                const relativeAtReaction = sub(bulletAtReaction, options.botPos);
                const relativeVelocity = sub(bulletVelocity, botVelocity);
                closest = Math.min(
                    closest,
                    closestOnSegment(
                        relativeAtReaction,
                        relativeVelocity,
                        maxTime - reactionSeconds,
                    ),
                );
            }
            minimumSeparation = Math.min(minimumSeparation, closest);
            if (closest <= safetyRadius) directHits += 1;
            const proximity = clamp(
                (safetyRadius + 4.2 - closest) / (safetyRadius + 4.2),
                0,
                1,
            );
            danger += proximity * proximity
                * (80 + Math.max(0, threat.bullet.damage) * 1.05);
        }

        if (options.targetPos && dot(direction, direction) > 1e-8) {
            const future = add(options.botPos, mul(botVelocity, 0.3));
            const preferredRange = Math.max(3, options.preferredRange ?? 18);
            danger += Math.abs(length(sub(future, options.targetPos)) - preferredRange) * 0.035;
        }
        return { danger, minimumSeparation, directHits, blocked: false };
    };

    const stationary = evaluate({ x: 0, y: 0 });
    let bestDirection: Vec2 | null = null;
    let bestEvaluation: ReturnType<typeof evaluate> | null = null;
    for (const direction of directions) {
        const evaluation = evaluate(direction);
        if (evaluation.blocked) continue;
        if (
            !bestEvaluation
            || evaluation.directHits < bestEvaluation.directHits
            || (evaluation.directHits === bestEvaluation.directHits
                && (evaluation.danger < bestEvaluation.danger - 0.01
                    || (Math.abs(evaluation.danger - bestEvaluation.danger) <= 0.01
                        && evaluation.minimumSeparation > bestEvaluation.minimumSeparation)))
        ) {
            bestDirection = direction;
            bestEvaluation = evaluation;
        }
    }
    if (!bestDirection || !bestEvaluation) return null;

    const avoidedHits = Math.max(0, stationary.directHits - bestEvaluation.directHits);
    const directHitEscape = stationary.directHits > 0 && avoidedHits > 0;

    // Central LEGIT/HACKER invariant: movement is permitted only when the
    // calculation proves it removes at least one otherwise-direct impact.
    // Near misses and unavoidable hits never interrupt aim or gun cadence.
    if (!directHitEscape) return null;

    return {
        direction: normalize(bestDirection),
        danger: bestEvaluation.danger,
        threats,
        stationaryHits: stationary.directHits,
        remainingHits: bestEvaluation.directHits,
        avoidedHits,
        stationarySeparation: stationary.minimumSeparation,
        minimumSeparation: bestEvaluation.minimumSeparation,
    };
}

export function isForbiddenContextResponse(value: unknown): value is ForbiddenContextSnapshot {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return record.type === "forbidden-context" && Number.isFinite(record.sequence);
}
