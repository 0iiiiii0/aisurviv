import { RawGameObjectDefs as GameObjectDefs } from "../../../shared/defs/gameObjectDefs.ts";
import { RawMapObjectDefs as MapObjectDefs } from "../../../shared/defs/mapObjectDefs.ts";
import { GameConfig } from "../../../shared/gameConfig.ts";

interface LootSpawnLike {
    tier?: string;
    min?: number;
    max?: number;
    type?: string;
    count?: number;
}

interface AnyDefinition {
    type?: string;
    obstacleType?: string;
    destructible?: boolean;
    explosion?: string;
    health?: number;
    loot?: LootSpawnLike[];
    armorPlated?: boolean;
    stonePlated?: boolean;
    isWall?: boolean;
    isTree?: boolean;
    door?: unknown;
    button?: unknown;
    smartLoot?: boolean;
    swapWeaponOnDestroy?: boolean;
    airdropCrate?: boolean;
    destroyType?: string;
    regrow?: boolean;
    lootSpawn?: unknown;
    damage?: number;
    obstacleDamage?: number;
    armorPiercing?: boolean;
    stonePiercing?: boolean;
    collision?: {
        rad?: number;
        min?: { x?: number; y?: number };
        max?: { x?: number; y?: number };
    };
    attack?: {
        offset?: { x?: number; y?: number };
        rad?: number;
        cooldownTime?: number;
    };
}

export type ResourceBreakClass =
    | "container"
    | "fixture"
    | "resource-node"
    | "special";

export const isCommonLootFixtureType = (
    objectType: string,
    obstacleType = "",
): boolean =>
    /locker|furniture|vending|toilet|pot|cabinet|cupboard|dresser|shelf|bookcase|wardrobe|nightstand|sink|oven|stove|desk/i
        .test(
            obstacleType,
        )
    || /locker|drawers|bookshelf|shelf|bookcase|cabinet|cupboard|dresser|wardrobe|nightstand|stand|mount|vending|toilet|planter|deposit|sink|oven|stove|desk/i
        .test(
            objectType,
        );

export interface LootBreakableProfile {
    type: string;
    obstacleType: string;
    resourceClass: ResourceBreakClass;
    health: number;
    lootEntries: number;
    expectedLootUnits: number;
    expectedLootValue: number;
    priorityBias: number;
    contactRadius: number;
    dangerous: boolean;
    explosionType: string;
    explosionRadius: number;
    armorPlated: boolean;
    stonePlated: boolean;
    /** Potato-style obstacle: the weapon used for the finishing hit is rerolled. */
    swapWeaponOnDestroy: boolean;
    /** True only when breaking this object can directly produce collectible loot. */
    searchLootEligible: boolean;
}

export interface ResourceBreakPlan extends LootBreakableProfile {
    meleeType: string;
    hitDamage: number;
    estimatedHits: number;
    estimatedSeconds: number;
    canDamage: boolean;
    feasible: boolean;
}

const finitePositive = (value: unknown, fallback: number): number => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const breakableProfileCache = new Map<string, LootBreakableProfile | null>();

/**
 * Desktop pickup uses player radius + loot radius on the authoritative server.
 * Keep a small margin because the server checks with a strict `<` comparison.
 */
export function lootPickupDistance(itemType: string): number {
    const definition = GameObjectDefs[itemType] as AnyDefinition | undefined;
    const definitionType = String(definition?.type ?? "");
    const lootRadius = finitePositive(GameConfig.lootRadius[definitionType], 1);
    return Math.max(1.35, GameConfig.player.radius + lootRadius - 0.16);
}

/**
 * Bots must stand close to their selected item because the wire input only says
 * "loot nearest" and cannot include an object id. A tight approach radius makes
 * the selected gun/ammo the nearest item in dense crate drops.
 */
export function lootApproachDistance(itemType: string): number {
    const definition = GameObjectDefs[itemType] as AnyDefinition | undefined;
    const type = String(definition?.type ?? "");
    const desired = type === "gun" ? 0.82 : type === "ammo" ? 0.94 : 1.02;
    return Math.min(lootPickupDistance(itemType), desired);
}

function collisionContactRadius(definition: AnyDefinition, scale: number): number {
    const collision = definition.collision;
    if (!collision) return 1.25 * scale;

    if (typeof collision.rad === "number" && collision.rad > 0) {
        return collision.rad * scale;
    }

    const min = collision.min;
    const max = collision.max;
    if (min && max) {
        const halfWidth = Math.abs(Number(max.x ?? 0) - Number(min.x ?? 0)) * 0.5;
        const halfHeight = Math.abs(Number(max.y ?? 0) - Number(min.y ?? 0)) * 0.5;
        const shortestHalfExtent = Math.min(
            halfWidth > 0 ? halfWidth : Number.POSITIVE_INFINITY,
            halfHeight > 0 ? halfHeight : Number.POSITIVE_INFINITY,
        );
        if (Number.isFinite(shortestHalfExtent)) {
            // The shortest extent is reachable from every orientation. Using the
            // diagonal would make the bot swing too early at long rectangular props.
            return Math.max(0.5, shortestHalfExtent * scale);
        }
    }

    return 1.25 * scale;
}

/** Maximum actor-centre to target-surface reach of a melee attack. */
export function meleeAttackReach(meleeType: string): number {
    const melee = GameObjectDefs[meleeType] as AnyDefinition | undefined;
    const attack = melee?.attack;
    const offsetX = Number(attack?.offset?.x ?? 1.35);
    const offsetY = Number(attack?.offset?.y ?? 0);
    const attackRadius = finitePositive(attack?.rad, 0.9);
    return Math.max(1.5, Math.hypot(offsetX, offsetY) + attackRadius - 0.1);
}

function expectedSpawnCount(entry: LootSpawnLike): number {
    if (Number.isFinite(Number(entry.count)) && Number(entry.count) > 0) {
        return Number(entry.count);
    }
    const min = finitePositive(entry.min, 1);
    const max = finitePositive(entry.max, min);
    return (min + Math.max(min, max)) * 0.5;
}

function directLootUnitValue(itemType: string): number {
    const definition = GameObjectDefs[itemType] as AnyDefinition | undefined;
    switch (String(definition?.type ?? "")) {
        case "gun":
            return 18;
        case "helmet":
        case "chest":
        case "backpack":
            return 14;
        case "scope":
            return 11;
        case "melee":
            return 9;
        case "heal":
        case "boost":
            return 8;
        case "throwable":
            return 7;
        case "ammo":
            return 4.5;
        default:
            return 6;
    }
}

function tierLootUnitValue(tier: string): number {
    const value = tier.toLowerCase();
    if (/mythic|meteor|chrys|ring|airdrop|rare|vault|class|perk/.test(value)) return 19;
    if (/soviet|military|guns|weapon|police|surviv/.test(value)) return 13;
    if (/throwable|grenade|ammo_crate/.test(value)) return 11.5;
    if (/container|world|toilet|vending|medical|heal/.test(value)) return 8;
    return 7;
}

function expectedLootValue(entries: readonly LootSpawnLike[]): {
    units: number;
    value: number;
} {
    let units = 0;
    let value = 0;
    for (const entry of entries) {
        const count = expectedSpawnCount(entry);
        units += count;
        const unitValue = entry.type
            ? directLootUnitValue(String(entry.type))
            : tierLootUnitValue(String(entry.tier ?? ""));
        value += count * unitValue;
    }
    return {
        units: clamp(units, 1, 30),
        value: clamp(value, 5, 240),
    };
}

function classifyResource(
    objectType: string,
    definition: AnyDefinition,
): { resourceClass: ResourceBreakClass; priorityBias: number } {
    const type = objectType.toLowerCase();
    const obstacleType = String(definition.obstacleType ?? "").toLowerCase();

    if (
        definition.airdropCrate
        || /airdrop|vault|deposit_box|safe|gold|mythic|meteor|class_crate|case_0[4-7]/.test(type)
    ) {
        return { resourceClass: "special", priorityBias: 34 };
    }
    if (/crate|chest|case|box/.test(obstacleType) || /crate|chest|case|cache|box/.test(type)) {
        const specificBias = /crate_14/.test(type)
            ? 34
            : /crate_0[46]/.test(type)
            ? 30
            : 18;
        return { resourceClass: "container", priorityBias: specificBias };
    }
    if (isCommonLootFixtureType(type, obstacleType)) {
        return { resourceClass: "fixture", priorityBias: 22 };
    }
    return {
        resourceClass: /tree|stone|rock|potato|pumpkin|squash|silo/.test(type)
            ? "resource-node"
            : "special",
        priorityBias: /potato|pumpkin|squash/.test(type) ? 10 : 2,
    };
}

/**
 * Returns every destructible resource or strategically useful breakable.
 * Some authoritative definitions do not carry a direct `loot` array: they use
 * destroyType, smartLoot, lootSpawn, regrowth or weapon-swap side effects.
 * Treating `loot.length > 0` as the definition of a resource made bots ignore
 * valid map objects that players routinely break.
 */
export function lootBreakableProfile(
    objectType: string,
    objectScale = 1,
): LootBreakableProfile | null {
    const scale = finitePositive(objectScale, 1);
    const cacheKey = `${objectType}|${scale.toFixed(3)}`;
    if (breakableProfileCache.has(cacheKey)) {
        return breakableProfileCache.get(cacheKey) ?? null;
    }

    const definition = MapObjectDefs[objectType] as AnyDefinition | undefined;
    const directLoot = Array.isArray(definition?.loot) ? definition.loot : [];
    const searchLootEligible = Boolean(
        directLoot.length > 0
            || definition?.smartLoot
            || definition?.airdropCrate
            || definition?.swapWeaponOnDestroy,
    );
    const strategicBreakable = Boolean(
        searchLootEligible
            || definition?.smartLoot
            || definition?.swapWeaponOnDestroy
            || definition?.airdropCrate
            || definition?.destroyType
            || definition?.regrow
            || definition?.lootSpawn
            || /tree|stone|rock|potato|pumpkin|squash|cache|crate|case|chest|locker|cabinet|wardrobe|bookshelf|deposit|safe|vending|toilet|planter|silo/i
                .test(
                    objectType,
                ),
    );
    if (
        !definition
        || definition.type !== "obstacle"
        || definition.destructible !== true
        || (directLoot.length === 0 && !strategicBreakable)
        || definition.door
        || definition.button
        || definition.isWall
    ) {
        breakableProfileCache.set(cacheKey, null);
        return null;
    }

    const expected = directLoot.length > 0
        ? expectedLootValue(directLoot)
        : {
            units: definition.airdropCrate || definition.smartLoot ? 2 : 1,
            value: definition.airdropCrate
                ? 70
                : definition.swapWeaponOnDestroy
                ? 44
                : definition.destroyType || definition.lootSpawn
                ? 24
                : /tree|stone|rock|potato|pumpkin|squash/i.test(objectType)
                ? 10
                : 8,
        };
    const classification = classifyResource(objectType, definition);
    const explosionType = String(definition.explosion ?? "");
    const explosionDef = GameObjectDefs[explosionType] as AnyDefinition | undefined;
    const explosionRadius = Math.max(
        0,
        Number((explosionDef as any)?.rad?.max ?? 0),
    );
    const profile: LootBreakableProfile = {
        type: objectType,
        obstacleType: String(definition.obstacleType ?? ""),
        resourceClass: classification.resourceClass,
        health: finitePositive(definition.health, 75),
        lootEntries: directLoot.length,
        expectedLootUnits: expected.units,
        expectedLootValue: expected.value,
        priorityBias: classification.priorityBias,
        contactRadius: collisionContactRadius(definition, scale),
        dangerous: Boolean(explosionType),
        explosionType,
        explosionRadius,
        armorPlated: Boolean(definition.armorPlated),
        stonePlated: Boolean(definition.stonePlated),
        swapWeaponOnDestroy: Boolean(definition.swapWeaponOnDestroy),
        searchLootEligible,
    };
    breakableProfileCache.set(cacheKey, profile);
    return profile;
}

/**
 * Estimates whether the currently equipped melee weapon can efficiently destroy
 * a resource obstacle. This mirrors the server's damage model: base melee damage
 * multiplied by obstacleDamage, with armor/stone piercing requirements.
 */
export function resourceBreakPlan(
    meleeType: string,
    objectType: string,
    remainingHealthT = 1,
    objectScale = 1,
    maxHits = 48,
): ResourceBreakPlan | null {
    const profile = lootBreakableProfile(objectType, objectScale);
    if (!profile) return null;

    const melee = GameObjectDefs[meleeType] as AnyDefinition | undefined;
    const isMelee = melee?.type === "melee";
    const armorAllowed = !profile.armorPlated || Boolean(melee?.armorPiercing);
    const stoneAllowed = !profile.stonePlated || Boolean(melee?.stonePiercing);
    const hitDamage = isMelee
        ? finitePositive(melee?.damage, 0) * finitePositive(melee?.obstacleDamage, 0)
        : 0;
    const canDamage = isMelee && hitDamage > 0 && armorAllowed && stoneAllowed;
    const remainingHealth = profile.health * clamp(remainingHealthT, 0.01, 1);
    const estimatedHits = canDamage
        ? Math.max(1, Math.ceil(remainingHealth / hitDamage))
        : Number.POSITIVE_INFINITY;
    const cooldown = finitePositive(melee?.attack?.cooldownTime, 0.3);
    const estimatedSeconds = Number.isFinite(estimatedHits)
        ? estimatedHits * cooldown
        : Number.POSITIVE_INFINITY;

    return {
        ...profile,
        meleeType,
        hitDamage,
        estimatedHits,
        estimatedSeconds,
        canDamage,
        feasible: canDamage
            && !profile.dangerous
            && estimatedHits <= Math.max(1, Math.floor(maxHits)),
    };
}

/**
 * Center-to-center distance at which a melee hit can reach a loot obstacle.
 * Includes the melee attack offset, attack circle and obstacle collision radius.
 */
export function meleeBreakDistance(
    meleeType: string,
    objectType: string,
    objectScale = 1,
): number {
    const melee = GameObjectDefs[meleeType] as AnyDefinition | undefined;
    const meleeReach = meleeAttackReach(meleeType);
    const breakable = lootBreakableProfile(objectType, objectScale);
    const obstacleRadius = breakable?.contactRadius ?? 1.25 * finitePositive(objectScale, 1);

    // The margin ensures the attack circles overlap rather than only touching.
    return Math.max(2.15, meleeReach + obstacleRadius - 0.18);
}
