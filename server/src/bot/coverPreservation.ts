import type { Vec2 } from "../../../shared/utils/v2.ts";

export interface CoverProtectionInput {
    botPos: Vec2;
    enemyPos: Vec2;
    coverPos: Vec2;
    coverRadius: number;
    /** The tactical cover system has already selected this exact obstacle. */
    currentCover?: boolean;
}

export interface CoverProtectionAssessment {
    protectsBot: boolean;
    botEdgeDistance: number;
    enemyEdgeDistance: number;
    alongSegment: number;
    reason: "current-cover" | "bot-side-cover" | "enemy-side-cover" | "not-close-enough" | "not-between";
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function distance(a: Vec2, b: Vec2): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Determines whether a blocking obstacle is currently more valuable as the
 * bot's shield than as an enemy obstruction to destroy.
 *
 * The important distinction is ownership of the near side of the cover. A
 * blocker close to the bot and substantially farther from the enemy protects
 * the bot from the enemy's direct fire. Destroying it would expose the bot, so
 * tactical cover-breaking must wait for a flank/peek instead.
 */
export function assessCoverProtection(input: CoverProtectionInput): CoverProtectionAssessment {
    const radius = Math.max(0.2, Number(input.coverRadius) || 0.2);
    const botToEnemyX = input.enemyPos.x - input.botPos.x;
    const botToEnemyY = input.enemyPos.y - input.botPos.y;
    const lineLengthSq = botToEnemyX * botToEnemyX + botToEnemyY * botToEnemyY;
    const botEdgeDistance = Math.max(0, distance(input.botPos, input.coverPos) - radius);
    const enemyEdgeDistance = Math.max(0, distance(input.enemyPos, input.coverPos) - radius);

    if (input.currentCover) {
        return {
            protectsBot: true,
            botEdgeDistance,
            enemyEdgeDistance,
            alongSegment: 0,
            reason: "current-cover",
        };
    }

    if (lineLengthSq <= 0.01) {
        return {
            protectsBot: false,
            botEdgeDistance,
            enemyEdgeDistance,
            alongSegment: 0,
            reason: "not-between",
        };
    }

    const relativeX = input.coverPos.x - input.botPos.x;
    const relativeY = input.coverPos.y - input.botPos.y;
    const alongSegment = clamp(
        (relativeX * botToEnemyX + relativeY * botToEnemyY) / lineLengthSq,
        0,
        1,
    );
    if (alongSegment <= 0.035 || alongSegment >= 0.965) {
        return {
            protectsBot: false,
            botEdgeDistance,
            enemyEdgeDistance,
            alongSegment,
            reason: "not-between",
        };
    }

    // A large obstacle can be useful from slightly farther away. The cap keeps
    // the rule from treating every wall in the bot's half of the map as owned.
    const shelterReach = clamp(2.2 + radius * 1.15, 3.2, 8.5);
    if (botEdgeDistance > shelterReach) {
        return {
            protectsBot: false,
            botEdgeDistance,
            enemyEdgeDistance,
            alongSegment,
            reason: "not-close-enough",
        };
    }

    const ownershipMargin = Math.max(1.15, radius * 0.42);
    const botOwnsNearSide = enemyEdgeDistance >= botEdgeDistance + ownershipMargin
        && (alongSegment <= 0.52 || botEdgeDistance * 1.35 < enemyEdgeDistance);

    return {
        protectsBot: botOwnsNearSide,
        botEdgeDistance,
        enemyEdgeDistance,
        alongSegment,
        reason: botOwnsNearSide ? "bot-side-cover" : "enemy-side-cover",
    };
}
