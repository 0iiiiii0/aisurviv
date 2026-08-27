import { ThrowableDefs } from "../../shared/defs/gameObjects/throwableDefs.ts";
import { GameConfig } from "../../shared/gameConfig.ts";
import { v2, type Vec2 } from "../../shared/utils/v2.ts";
import { getDuelWeaponCatalog, isDuelWeapon } from "./duelWeapons.ts";

export const AIM_TRAINING_MIN_DISTANCE = 12;
export const AIM_TRAINING_MAX_DISTANCE = 160;
export const AIM_TRAINING_DEFAULT_DISTANCE = 60;
// Use values safely inside each boost band instead of exact breakpoints.
export const AIM_TRAINING_BOOST_LEVELS = [0, 12, 38, 69, 100] as const;
export const AIM_TRAINING_RETURN_IDLE_SECONDS = 0.65;
export const AIM_TRAINING_RETURN_LEASH = 7.5;
export const AIM_TRAINING_RETURN_SETTLE_RADIUS = 1.25;

export interface AimTrainingSettings {
    weapon0: string;
    weapon1: string;
    throwable: string;
    infiniteMagazine: boolean;
    targetBoost: number;
    helmetLevel: number;
    chestLevel: number;
    normalHealth: boolean;
    distance: number;
    verticalRandomMovement: boolean;
    omnidirectionalRandomMovement: boolean;
    dodgeBullets: boolean;
}

export class AimTrainingError extends Error {}

export interface AimTrainingRoomReadiness {
    humanPlayerCount?: number;
    aiPlayerCount: number;
    serverBotCount: number;
    stopped?: boolean;
}

export interface AimTrainingReturnDecision {
    anchor: Vec2;
    direction?: Vec2;
    distanceToAnchor: number;
    returning: boolean;
}

/**
 * Keeps bullet-dodging targets near the selected practice distance. The wider
 * start radius and tighter settle radius provide hysteresis so an idle target
 * walks all the way home instead of flickering between return and random move.
 */
export function aimTrainingReturnDecision(input: {
    targetPos: Vec2;
    traineePos: Vec2;
    configuredDistance: number;
    idleSeconds: number;
    wasReturning: boolean;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}): AimTrainingReturnDecision {
    const anchor = v2.create(
        Math.max(input.minX, Math.min(input.maxX, input.traineePos.x + input.configuredDistance)),
        Math.max(input.minY, Math.min(input.maxY, input.traineePos.y)),
    );
    const offset = v2.sub(anchor, input.targetPos);
    const distanceToAnchor = v2.length(offset);
    const outsideReturnRadius = input.wasReturning
        ? distanceToAnchor > AIM_TRAINING_RETURN_SETTLE_RADIUS
        : distanceToAnchor > AIM_TRAINING_RETURN_LEASH;
    const returning = input.idleSeconds >= AIM_TRAINING_RETURN_IDLE_SECONDS
        && outsideReturnRadius;

    return {
        anchor,
        distanceToAnchor,
        returning,
        direction: returning ? v2.normalize(offset) : undefined,
    };
}

export function aimTrainingHumanReady(room: AimTrainingRoomReadiness | undefined): boolean {
    return Boolean(
        room
            && !room.stopped
            && Number(room.humanPlayerCount ?? 0) >= 1,
    );
}

export async function waitForAimTrainingHuman(
    getRoom: () => AimTrainingRoomReadiness | undefined,
    timeoutMs = 30_000,
    pollMs = 60,
): Promise<boolean> {
    const deadline = Date.now() + Math.max(1, timeoutMs);
    const delay = Math.max(1, pollMs);
    while (Date.now() < deadline) {
        if (aimTrainingHumanReady(getRoom())) return true;
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
    return aimTrainingHumanReady(getRoom());
}

export function aimTrainingTargetReady(room: AimTrainingRoomReadiness | undefined): boolean {
    return Boolean(
        room
            && !room.stopped
            && room.aiPlayerCount >= 1
            && room.serverBotCount >= 1,
    );
}

export async function waitForAimTrainingTarget(
    getRoom: () => AimTrainingRoomReadiness | undefined,
    timeoutMs = 9000,
    pollMs = 60,
): Promise<boolean> {
    const deadline = Date.now() + Math.max(1, timeoutMs);
    const delay = Math.max(1, pollMs);
    while (Date.now() < deadline) {
        if (aimTrainingTargetReady(getRoom())) return true;
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
    return aimTrainingTargetReady(getRoom());
}

export function aimTrainingSpeedBonusPercent(level: number): number {
    return level >= 50 ? GameConfig.player.boostMoveSpeed / GameConfig.player.moveSpeed * 100 : 0;
}

export function aimTrainingAccuracy(shotsFired: number, hits: number): number {
    return shotsFired > 0 ? Math.max(0, hits) / shotsFired * 100 : 0;
}

export function useInfiniteTrainingMagazine(
    mapName: string,
    serverBot: boolean,
    enabled: boolean,
): boolean {
    return mapName === "aim_training" && !serverBot && enabled;
}

export function healthAfterTrainingDamage(
    immortalTrainingTarget: boolean,
    currentHealth: number,
    damage: number,
): number {
    return immortalTrainingTarget
        ? GameConfig.player.health
        : Math.max(0, currentHealth - Math.max(0, damage));
}

export function normalizeAimTrainingSettings(value: unknown): AimTrainingSettings {
    const input = value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    const legacyWeapon = input.weapon;
    const weapon0 = isDuelWeapon(input.weapon0)
        ? input.weapon0
        : isDuelWeapon(legacyWeapon)
        ? legacyWeapon
        : "m4a1";
    const weapon1 = isDuelWeapon(input.weapon1) ? input.weapon1 : "mk12";
    const throwable = typeof input.throwable === "string"
            && Boolean(ThrowableDefs[input.throwable]?.handImg)
            && !ThrowableDefs[input.throwable].noPotatoSwap
        ? input.throwable
        : "frag";
    const targetBoostRaw = Math.round(Number(input.targetBoost));
    const targetBoost = AIM_TRAINING_BOOST_LEVELS.includes(targetBoostRaw as (typeof AIM_TRAINING_BOOST_LEVELS)[number])
        ? targetBoostRaw
        : 38;
    const armorLevel = (value: unknown): number => {
        const level = Math.round(Number(value));
        return Number.isFinite(level) ? Math.max(0, Math.min(3, level)) : 0;
    };
    const distanceRaw = Math.round(Number(input.distance));
    const distance = Number.isFinite(distanceRaw)
        ? Math.max(AIM_TRAINING_MIN_DISTANCE, Math.min(AIM_TRAINING_MAX_DISTANCE, distanceRaw))
        : AIM_TRAINING_DEFAULT_DISTANCE;
    return {
        weapon0,
        weapon1,
        throwable,
        infiniteMagazine: input.infiniteMagazine === true,
        targetBoost,
        helmetLevel: armorLevel(input.helmetLevel),
        chestLevel: armorLevel(input.chestLevel),
        normalHealth: input.normalHealth === true,
        distance,
        verticalRandomMovement: input.verticalRandomMovement !== false,
        omnidirectionalRandomMovement: input.omnidirectionalRandomMovement === true,
        dodgeBullets: input.dodgeBullets === true,
    };
}

export function aimTrainingCatalog() {
    const speedBonus = GameConfig.player.boostMoveSpeed;
    const baseSpeed = GameConfig.player.moveSpeed;
    return {
        weapons: getDuelWeaponCatalog().filter((weapon) => weapon.id !== "bugle"),
        throwables: Object.entries(ThrowableDefs)
            .filter(([, def]) => Boolean(def.handImg) && !def.noPotatoSwap)
            .sort((a, b) => a[1].inventoryOrder - b[1].inventoryOrder)
            .map(([id, def]) => ({
                id,
                name: def.name,
                image: `/img/loot/${def.lootImg.sprite.replace(/\.img$/, ".svg")}`,
            })),
        boostLevels: AIM_TRAINING_BOOST_LEVELS.map((level) => ({
            level,
            speedBonus: level >= 50 ? speedBonus : 0,
            baseSpeed,
            resultingBaseSpeed: baseSpeed + (level >= 50 ? speedBonus : 0),
            percentBonus: aimTrainingSpeedBonusPercent(level),
        })),
        distances: [12, 20, 30, 40, 50, 60, 80, 100, 120, 140, 160],
        defaults: normalizeAimTrainingSettings({}),
    };
}
