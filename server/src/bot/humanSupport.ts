import type { Vec2 } from "../../../shared/utils/v2.ts";

/**
 * Hard cap for how far an escort bot may trail the human before giving up.
 * The map is 1024x1024 and players run at roughly the same speed, so a squad
 * drawn from the mid-field (assigned within ~360u) needs room to catch up
 * while the human keeps pushing.
 */
export const HUMAN_SUPPORT_MAX_DISTANCE = 420;

export interface HumanPushObservation {
    botId: number;
    teamId: number;
    botPos: Vec2;
    humanId: number;
    humanPos: Vec2;
    /** Approximate human velocity (units/s) from recent position deltas. */
    humanVelocity: Vec2;
    /** Faction spawn anchor of our team (friendly rear). */
    homeAnchor: Vec2 | null;
    mapCenter: Vec2;
    /** True while the human's health has been dropping recently (under fire). */
    humanUnderFire: boolean;
    humanDowned: boolean;
    humanDead: boolean;
    timestamp: number;
}

export interface HumanPushDecision {
    pushing: boolean;
    pushDirection: Vec2;
    reason: string;
}

const normalize = (value: Vec2, fallback: Vec2 = { x: 1, y: 0 }): Vec2 => {
    const len = Math.hypot(value.x, value.y);
    return len > 1e-5 ? { x: value.x / len, y: value.y / len } : fallback;
};

/**
 * A human is "pushing" when they are ahead of the friendly rear and either
 * actively moving toward the enemy side or locked in a fight there. Standing
 * at the rear looting does not count; a stationary human under fire does.
 */
export function detectHumanPush(input: HumanPushObservation): HumanPushDecision {
    if (input.humanDead || input.humanDowned) {
        return {
            pushing: false,
            pushDirection: normalize(input.humanVelocity, { x: 1, y: 0 }),
            reason: "human-dead-or-downed",
        };
    }
    const home = input.homeAnchor ?? input.botPos;
    const pushDirection = normalize(
        {
            x: input.mapCenter.x - home.x,
            y: input.mapCenter.y - home.y,
        },
        { x: 1, y: 0 },
    );
    const humanDepth = dot(sub(input.humanPos, home), pushDirection);
    const botDepth = dot(sub(input.botPos, home), pushDirection);
    const aheadOfBot = humanDepth > botDepth + 6;
    const aheadOfRear = humanDepth > 18;
    const speed = Math.hypot(input.humanVelocity.x, input.humanVelocity.y);
    const forwardSpeed = speed > 0.1
        ? dot(normalize(input.humanVelocity), pushDirection) * speed
        : 0;
    const movingForward = forwardSpeed > 2.0;
    const pushing = aheadOfBot && aheadOfRear && (movingForward || input.humanUnderFire);
    return {
        pushing,
        pushDirection,
        reason: pushing
            ? input.humanUnderFire
                ? "human-advancing-under-fire"
                : "human-pushing-forward"
            : "human-not-pushing",
    };
}

/**
 * Deterministic per-bot assignment so every worker selects the same subset:
 * about one in `share` equipped bots escorts the pushing human.
 */
export function shouldEscortHuman(input: {
    botId: number;
    teamId: number;
    humanId: number;
    /** Optional: bots farther than maxDistance from the human do not volunteer. */
    distanceToHuman?: number;
    maxDistance?: number;
    share?: number;
}): boolean {
    const maxDistance = input.maxDistance ?? 360;
    if (
        input.distanceToHuman !== undefined
        && input.distanceToHuman > maxDistance
    ) {
        return false;
    }
    const share = Math.max(2, Math.min(8, input.share ?? 4));
    const selector = (input.botId * 31 + input.teamId * 17 + input.humanId * 7) % share;
    return selector === 0;
}

/**
 * Support position: slightly behind the human along the push axis, on the
 * friendly side, with a small deterministic side offset per bot so the escort
 * fans out instead of stacking.
 */
export function humanSupportPoint(input: {
    humanPos: Vec2;
    pushDirection: Vec2;
    botId: number;
    mapWidth: number;
    mapHeight: number;
}): Vec2 {
    const side = { x: -input.pushDirection.y, y: input.pushDirection.x };
    const behind = sub(
        input.humanPos,
        mul(input.pushDirection, 10 + (input.botId % 5) * 2.2),
    );
    const sideOffset = mul(side, input.botId % 2 === 0 ? 4 : -4);
    const margin = 2;
    return {
        x: clamp(behind.x + sideOffset.x, margin, input.mapWidth - margin),
        y: clamp(behind.y + sideOffset.y, margin, input.mapHeight - margin),
    };
}

/** The escort should stop once the human stops pushing (or dies / too far). */
export function shouldDisbandSupport(input: {
    pushing: boolean;
    humanDead: boolean;
    humanDowned: boolean;
    distanceToHuman: number;
    pushLatchMs: number;
    lastPushAt: number;
    timestamp: number;
    /** Optional escort-start metadata used for the catch-up progress check. */
    startedAt?: number;
    startDistance?: number;
}): boolean {
    if (input.humanDead || input.humanDowned) return true;
    if (input.distanceToHuman > HUMAN_SUPPORT_MAX_DISTANCE) return true;
    // Give the squad time to close the gap: a bot that has been chasing for
    // 12+ seconds without meaningful progress is likely stuck or outpaced.
    const escortAge = Math.max(0, input.timestamp - (input.startedAt ?? 0));
    if (
        escortAge > 12000
        && input.distanceToHuman
            > Math.max(160, (input.startDistance ?? 0) - 80)
    ) {
        return true;
    }
    if (!input.pushing && input.timestamp - input.lastPushAt >= input.pushLatchMs) {
        return true;
    }
    return false;
}

const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
