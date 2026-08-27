export interface ObstacleDefinitionLike {
    type?: string;
    collidable?: boolean;
    height?: number;
    destructible?: boolean;
    isWindow?: boolean;
    isWall?: boolean;
    reflectBullets?: boolean;
    armorPlated?: boolean;
    stonePlated?: boolean;
}

export interface ObstacleRuntimeLike {
    dead?: boolean;
    healthT?: number;
    isDoor?: boolean;
    height?: number;
    door?: {
        open?: boolean;
        canUse?: boolean;
        locked?: boolean;
    };
}

/** Non-solid visual/environmental objects that local movement may ignore. */
export function isMovementTransparentObstacleType(type: string): boolean {
    return /bush|grass|smoke|water|river|decal|floor|stair/i.test(type);
}

/**
 * 弹道透明障碍：子弹穿过且不影响命中判定的对象。
 * - 灌木/草/烟：不挡子弹；
 * - 窗户（isWindow/含 window 名，health 1）：第一发打碎后即穿透，不作为
 *   弹道阻挡（AI 隔窗直接射击，与真实玩法一致）。
 * 注意：玻璃墙（glass_wall_*，health 50+）不是弹道透明——子弹必须先打碎
 * 它们。AI 若把它们当透明，就会对着玻璃墙不停开枪却打不中墙后敌人。
 */
export function isBulletTransparentObstacleType(type: string): boolean {
    return /bush|grass|smoke|window/i.test(type);
}

/** Mirrors the server bullet collision gate for a live obstacle. */
export function blocksBulletCollision(options: {
    type: string;
    definition?: ObstacleDefinitionLike;
    runtime?: ObstacleRuntimeLike;
    bulletHeight: number;
}): boolean {
    const { type, definition, runtime } = options;
    if (runtime?.dead || Number(runtime?.healthT ?? 1) <= 0) return false;
    if (runtime?.isDoor && runtime.door?.open) return false;
    if (definition?.collidable === false) return false;
    if (isBulletTransparentObstacleType(type)) return false;
    const height = Number(runtime?.height ?? definition?.height ?? Number.POSITIVE_INFINITY);
    return height >= Math.max(0, Number(options.bulletHeight) || 0);
}

/**
 * Intact windows are visually transparent but remain physical walls in this
 * project. They must never be treated as building entrances. A window's
 * destroyed residue is also collidable, so routing should still use a door.
 */
export function isWindowObstacle(
    type: string,
    definition: ObstacleDefinitionLike | undefined,
): boolean {
    return definition?.isWindow === true || /window/i.test(type);
}

export function blocksLocalMovement(options: {
    type: string;
    definition?: ObstacleDefinitionLike;
    runtime?: ObstacleRuntimeLike;
}): boolean {
    const { type, definition, runtime } = options;
    if (runtime?.dead) return false;
    if (runtime?.isDoor && runtime.door?.open) return false;
    if (isMovementTransparentObstacleType(type)) return false;
    return definition?.collidable !== false;
}

/**
 * Authoritative cover-destruction gate. Name matching alone is unsafe because
 * many warehouse/container/brick wall pieces contain "wall" in their name but
 * are explicitly indestructible in MapObjectDefs.
 */
export function isAuthoritativelyDestructibleCover(options: {
    type: string;
    definition?: ObstacleDefinitionLike;
    runtime?: ObstacleRuntimeLike;
    allowWindow?: boolean;
}): boolean {
    const { type, definition, runtime } = options;
    if (runtime?.dead || Number(runtime?.healthT ?? 1) <= 0.08) return false;
    if (runtime?.isDoor && runtime.door?.open) return false;
    if (runtime?.isDoor && runtime.door?.canUse && !runtime.door?.locked) return false;
    if (!definition || definition.type !== "obstacle") return false;
    if (definition.collidable === false || definition.destructible !== true) return false;
    // Armor/stone plating is destructible only by specific mechanics. Ordinary
    // firearm obstacle damage is ineffective and must not be wasted on it.
    if (definition.armorPlated || definition.stonePlated) return false;
    if (!options.allowWindow && isWindowObstacle(type, definition)) return false;
    return true;
}

export function isHardIndestructibleCover(options: {
    type: string;
    definition?: ObstacleDefinitionLike;
    runtime?: ObstacleRuntimeLike;
}): boolean {
    const { type, definition, runtime } = options;
    if (runtime?.dead || definition?.collidable === false) return false;
    if (isMovementTransparentObstacleType(type)) return false;
    if (runtime?.isDoor && runtime.door?.open) return false;
    return definition?.destructible === false;
}
