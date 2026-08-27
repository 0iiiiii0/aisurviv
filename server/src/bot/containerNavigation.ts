import { math } from "../../../shared/utils/math.ts";
import type { Vec2 } from "../../../shared/utils/v2.ts";
import { v2 } from "../../../shared/utils/v2.ts";

export interface ContainerRouteGeometry {
    entranceOutside: Vec2;
    entranceInside: Vec2;
    botInside: boolean;
    targetInside: boolean;
}

export interface ContainerObstacleDefinition {
    type?: string;
    destructible?: boolean;
    collidable?: boolean;
    door?: unknown;
    button?: unknown;
    explosion?: unknown;
    armorPlated?: boolean;
    stonePlated?: boolean;
    health?: number;
    obstacleType?: string;
    hitParticle?: string | string[];
    explodeParticle?: string | string[];
    sound?: {
        bullet?: string;
        punch?: string;
        explode?: string;
    };
}

export const isShippingContainerType = (type: string): boolean => /^container_(?:0[1-6]|01x)$/i.test(type);

/**
 * Surviv.io shipping containers have one usable opening at local negative Y.
 * Loot is spawned deeper inside, so approaching it by straight-line distance
 * often drives a bot into a side wall. This helper exposes the two-stage route:
 * outside mouth -> just inside mouth -> loot.
 */
export const shippingContainerRoute = (
    buildingType: string,
    center: Vec2,
    orientation: number,
    from: Vec2,
    target: Vec2,
): ContainerRouteGeometry | null => {
    if (!isShippingContainerType(buildingType)) return null;

    const rotation = math.oriToRad(orientation);
    const localTarget = v2.rotate(v2.sub(target, center), -rotation);
    const openContainer = /^container_04$/i.test(buildingType);
    const targetMinY = openContainer ? -11.4 : -4.1;
    const targetMaxY = openContainer ? 11.4 : 8.75;
    if (Math.abs(localTarget.x) > 3.15 || localTarget.y < targetMinY || localTarget.y > targetMaxY) {
        return null;
    }

    const localBot = v2.rotate(v2.sub(from, center), -rotation);
    const botInside = Math.abs(localBot.x) <= 2.7
        && localBot.y >= (openContainer ? -10.9 : -3.45)
        && localBot.y <= (openContainer ? 10.9 : 8.35);

    // Closed containers open at local -Y. The open-through variant can be
    // entered from either end, so select the end that is closer to the bot.
    let outsideLocal = v2.create(0, -5.35);
    let insideLocal = v2.create(0, -2.45);
    if (openContainer && localBot.y > 0) {
        outsideLocal = v2.create(0, 12.1);
        insideLocal = v2.create(0, 9.8);
    } else if (openContainer) {
        outsideLocal = v2.create(0, -12.1);
        insideLocal = v2.create(0, -9.8);
    }

    return {
        entranceOutside: v2.add(center, v2.rotate(outsideLocal, rotation)),
        entranceInside: v2.add(center, v2.rotate(insideLocal, rotation)),
        botInside,
        targetInside: true,
    };
};

const textIncludesWood = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(textIncludesWood);
    return /wood|plank|board|barricade/i.test(String(value ?? ""));
};

/**
 * A blocker across a container mouth should be cleared only when it is a safe,
 * destructible wooden/furniture object. Metal container walls, explosive
 * barrels and plated obstacles are deliberately excluded.
 */
export const isSafeContainerEntryBlocker = (
    objectType: string,
    definition: ContainerObstacleDefinition | undefined,
): boolean => {
    if (
        !definition
        || definition.type !== "obstacle"
        || definition.destructible !== true
        || definition.collidable === false
        || definition.door
        || definition.button
        || definition.explosion
        || definition.armorPlated
        || definition.stonePlated
    ) {
        return false;
    }

    const obstacleType = String(definition.obstacleType ?? "");
    const soundText = [
        definition.sound?.bullet,
        definition.sound?.punch,
        definition.sound?.explode,
    ].join(" ");
    const visualMaterial = [definition.hitParticle, definition.explodeParticle];
    const explicitlyWooden =
        /plank|board|barricade|wood|crate|box|fence|chair|table|shelf|cabinet|locker|drawer/i.test(objectType)
        || /wood|crate|furniture|barricade|locker/i.test(obstacleType)
        || textIncludesWood(soundText)
        || visualMaterial.some(textIncludesWood);

    // Low-health furniture occasionally uses a neutral name but is still a
    // legitimate entrance obstruction. Keep this fallback conservative.
    const lightFurniture = Number(definition.health ?? Infinity) <= 160
        && /furniture|crate|locker/i.test(obstacleType);
    return explicitlyWooden || lightFurniture;
};
