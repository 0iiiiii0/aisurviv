import { type LootDef } from "../../../../shared/defs/gameObjectDefs.ts";
import type { MapDef } from "../../../../shared/defs/mapDefs.ts";
import { GameObjectDefs } from "../../../../shared/defs/register.ts";
import { GameConfig } from "../../../../shared/gameConfig.ts";
import { ObjectType } from "../../../../shared/net/objectSerializeFns.ts";
import { type AABB, type Circle, coldet, type Collider } from "../../../../shared/utils/coldet.ts";
import { collider } from "../../../../shared/utils/collider.ts";
import { math } from "../../../../shared/utils/math.ts";
import type { River } from "../../../../shared/utils/river.ts";
import { assert, util } from "../../../../shared/utils/util.ts";
import { v2, type Vec2 } from "../../../../shared/utils/v2.ts";
import type { Game } from "../game.ts";
import { HashGrid } from "../grid.ts";
import { BaseGameObject } from "./gameObject.ts";
import type { MapIndicator } from "./mapIndicator.ts";
import type { Player } from "./player.ts";
import type { Structure } from "./structure.ts";

const AMMO_OFFSET_X = 0.75;
const AMMO_OFFSET_Y = -0.075;
/**
 * 搜打撤高级物资：这些物品在搜打撤地图上的掉落权重会被大幅降低
 * （仅影响 extractionMode，不改变其他模式）。
 * - S+ / S 级枪械（与 1v1 武器分级一致）；
 * - 三级护甲 / 头盔；
 * - AWM 弹药（.308）、信号弹、信号枪；
 * - 8x / 15x 倍镜。
 */
const EXTRACTION_RARE_LOOT = new Set<string>([
    // S+
    "awc",
    "m1014",
    "potato_cannon",
    "usas",
    // S
    "m4a1",
    "m249",
    "mosin",
    "potato_smg",
    "saiga",
    "scarssr",
    "spas12",
    "sv98",
    // 三级护甲 / 头盔
    "helmet03",
    "chest03",
    // AWM 弹药 / 信号弹 / 信号枪
    "308sub",
    "flare",
    "flare_gun",
    "flare_gun_dual",
    // 8x / 15x 倍镜
    "8xscope",
    "15xscope",
]);

/** 搜打撤中级物资（权重放大）：A/B 级枪械、二级护甲、4x 倍镜、中档药品/弹药。 */
const EXTRACTION_MID_LOOT = new Set<string>([
    // A/B 级枪械
    "an94",
    "bar",
    "deagle",
    "garand",
    "groza",
    "grozas",
    "l86",
    "mkg45",
    "mp220",
    "p30l",
    "pkp",
    "qbb97",
    "scar",
    "scorpion",
    "svd",
    "vector",
    "vector45",
    "ak47",
    "blr",
    "colt45",
    "dp28",
    "famas",
    "hk416",
    "m1a1",
    "m1100",
    "m39",
    "m870",
    "mac10",
    "mk12",
    "mp5",
    "ots38",
    "scout_elite",
    "ump9",
    "vss",
    // 二级护甲
    "helmet02",
    "chest02",
    "backpack02",
    // 4x 倍镜
    "4xscope",
    // 中档药品 / 弹药 / 投掷物
    "healthkit",
    "painkiller",
    "50AE",
    "frag",
    "smoke",
]);

/** 搜打撤低级物资（权重缩小）：C/D 级枪械、一级护甲、2x 倍镜、常用药品/弹药。 */
const EXTRACTION_LOW_LOOT = new Set<string>([
    // C/D 级枪械
    "glock",
    "m1911",
    "m93r",
    "model94",
    "ot38",
    "m9",
    // 一级护甲
    "helmet01",
    "chest01",
    "backpack01",
    // 2x 倍镜
    "2xscope",
    // 常用药品 / 弹药
    "bandage",
    "soda",
    "9mm",
    "45acp",
    "12gauge",
    "556mm",
    "762mm",
]);

/** 搜打撤普通子弹（低级弹药）：地图/资源点掉落数量除以 10。 */
const EXTRACTION_HIGH_AMMO_LOOT = new Set<string>([
    "50AE",
    "308sub",
    "flare",
]);

/**
 * Search-fight-extract (normal + secret) ammo quantity reduction:
 * regular ammo /10, high-tier ammo (50AE/.338/flare) /5.
 * The SAME rules apply to both standalone ammo from lootTable and the ammo
 * that spawns alongside weapons (weapon crates, preloaded map guns, death
 * drops), so the "reduce extraction bullet production by 90%" rule is complete.
 */
function extractionAmmoCount(ammoType: string, count: number): number {
    const def = GameObjectDefs.typeToDefSafe(ammoType);
    if (def?.type !== "ammo") return count;
    return Math.max(1, Math.floor(count * 0.5));
}

/** 搜打撤（普通）高级物资权重缩放：降到原来的 10%（大幅降低掉率）。 */
const EXTRACTION_RARE_WEIGHT_SCALE = 0.1;
/** 搜打撤·绝密模式高级物资权重缩放：提高到原来的 12 倍。 */
const EXTRACTION_SECRET_WEIGHT_SCALE = 12;
/** 搜打撤低级物资权重缩放：降低出现概率（减半）。 */
const EXTRACTION_LOW_WEIGHT_SCALE = 0.5;
/** 搜打撤中级物资权重缩放：提高出现概率（1.5 倍）。 */
const EXTRACTION_MID_WEIGHT_SCALE = 1.5;

// velocity drag applied every tick
const LOOT_DRAG = 3;
// how much loot pushes each other every tick
const LOOT_PUSH_FORCE = 6;
// Keep physics stable when the game loop stalls. Loot is cosmetic/collectible,
// so slowing a launch during a long hitch is preferable to tunnelling through a
// thin building wall and becoming unreachable.
const MAX_LOOT_MOVEMENT_DT = 0.1;
const MAX_LOOT_SUBSTEPS = 48;

export function lootMovementPlan(
    speed: number,
    dt: number,
    radius: number,
): { movementDt: number; steps: number; maxStepDistance: number } {
    const movementDt = Math.min(Math.max(0, dt), MAX_LOOT_MOVEMENT_DT);
    const travelDistance = Math.max(0, speed) * movementDt;
    const maxStepDistance = Math.max(0.1, Math.max(0, radius) * 0.24);
    return {
        movementDt,
        steps: Math.max(
            1,
            Math.min(MAX_LOOT_SUBSTEPS, Math.ceil(travelDistance / maxStepDistance)),
        ),
        maxStepDistance,
    };
}

export interface LootSweepHit {
    point: Vec2;
    normal: Vec2;
    t: number;
}

export function releaseExpiredLootOwner(
    loot: { ownerId: number; ownerExpiresAt: number },
    timestamp: number,
): boolean {
    if (
        loot.ownerId === 0
        || loot.ownerExpiresAt <= 0
        || timestamp < loot.ownerExpiresAt
    ) {
        return false;
    }
    loot.ownerId = 0;
    loot.ownerExpiresAt = 0;
    return true;
}

/** Continuous collision for a moving loot circle against a static collider. */
export function sweepLootCircleAgainstCollider(
    start: Vec2,
    desired: Vec2,
    radius: number,
    obstacle: AABB | Circle,
): LootSweepHit | null {
    const movement = v2.sub(desired, start);
    const travel = Math.max(0.000001, v2.length(movement));
    const result = obstacle.type === collider.Type.Aabb
        ? coldet.intersectSegmentAabb(
            start,
            desired,
            v2.create(obstacle.min.x - radius, obstacle.min.y - radius),
            v2.create(obstacle.max.x + radius, obstacle.max.y + radius),
        )
        : coldet.intersectSegmentCircle(
            start,
            desired,
            obstacle.pos,
            obstacle.rad + radius,
        );
    if (!result) return null;
    const normal = v2.create(result.normal.x, result.normal.y);
    const hitDistance = v2.length(v2.sub(result.point, start));
    const t = math.clamp(hitDistance / travel, 0, 1);
    // A segment beginning exactly on a boundary must be free to move away.
    if (t <= 0.0001 && v2.dot(movement, normal) >= 0) return null;
    return {
        point: v2.create(result.point.x, result.point.y),
        normal,
        t,
    };
}

// explosion push force multiplier
export const EXPLOSION_LOOT_PUSH_FORCE = 6;

type LootTierItem = MapDef["lootTable"][string][number];

export interface LootRollOptions {
    /** False for perk-generated rewards that must not inherit secret-mode rarity boosts. */
    applyExtractionSecretBonus?: boolean;
}

export interface AddLootOptions {
    useCountForAmmo?: boolean;
    pushSpeed?: number;
    dir?: Vec2;
    noSideAmmo?: boolean;
    preloadGun?: boolean;
    source?: "player" | "obstacle" | "map";
    ownerId?: number;
    ownerExpiresAt?: number;
    oneTimePerk?: boolean;
}

export function extractionLootWeight(
    itemName: string,
    baseWeight: number,
    extractionMode: boolean,
    secretMode: boolean,
    applyExtractionSecretBonus = true,
): number {
    let weight = baseWeight;
    const rareScale = secretMode && applyExtractionSecretBonus
        ? EXTRACTION_SECRET_WEIGHT_SCALE
        : extractionMode && !secretMode
        ? EXTRACTION_RARE_WEIGHT_SCALE
        : 1;
    if (rareScale !== 1 && EXTRACTION_RARE_LOOT.has(itemName)) {
        weight *= rareScale;
    } else if (extractionMode && EXTRACTION_MID_LOOT.has(itemName)) {
        weight *= EXTRACTION_MID_WEIGHT_SCALE;
    } else if (extractionMode && EXTRACTION_LOW_LOOT.has(itemName)) {
        weight *= EXTRACTION_LOW_WEIGHT_SCALE;
    }
    if (extractionMode && EXTRACTION_HIGH_AMMO_LOOT.has(itemName)) {
        weight *= 0.5;
    }
    return weight;
}

export class LootBarn {
    loots: Loot[] = [];
    newLoots: Loot[] = [];

    private _cachedTiers: Record<string, () => LootTierItem | undefined> = {};
    private readonly _warnedInvalidLoot = new Set<string>();

    grid: HashGrid;

    constructor(public game: Game) {
        this.grid = new HashGrid(this.game.map.width, this.game.map.height, 16);
    }

    update(dt: number) {
        // check for loot to loot collision on the hashgrid
        this.grid.check(
            this.loots,
            (a, b) => {
                return (
                    (util.sameLayer(a.layer, b.layer) as boolean)
                    && coldet.testCircleCircle(a.pos, a.lootRad, b.pos, b.lootRad)
                );
            },
            (a, b) => {
                const res = coldet.intersectCircleCircle(
                    a.pos,
                    a.lootRad,
                    b.pos,
                    b.lootRad,
                );
                if (!res) return;

                const forceFactor = 2.5;
                const minForce = 0.125;
                const forceA = math.max(res.pen / a.lootRad, minForce) * forceFactor;
                const forceB = math.max(res.pen / b.lootRad, minForce) * forceFactor;
                v2.set(a.pos, v2.sub(a.pos, v2.mul(res.dir, forceA * dt)));
                v2.set(b.pos, v2.add(b.pos, v2.mul(res.dir, forceB * dt)));
            },
        );

        for (let i = 0; i < this.loots.length; i++) {
            const loot = this.loots[i];
            if (loot.destroyed) {
                this.loots.splice(i, 1);
                i--;
                continue;
            }
            loot.update(dt);
        }
    }

    flush() {
        for (let i = 0; i < this.newLoots.length; i++) {
            this.newLoots[i].isOld = true;
            this.newLoots[i].serializeFull();
        }
        this.newLoots.length = 0;
    }

    clear(): void {
        for (const loot of this.loots) {
            if (!loot.destroyed) loot.destroy();
        }
        this.loots.length = 0;
    }

    splitUpLoot(player: Player, item: string, amount: number, dir: Vec2) {
        const dropCount = Math.floor(amount / 60);
        for (let i = 0; i < dropCount; i++) {
            this.addLoot(item, player.pos, player.layer, 60, false, -4, dir);
        }
        if (amount % 60 !== 0) {
            this.addLoot(item, player.pos, player.layer, amount % 60, false, -4, dir);
        }
    }

    /**
     * spawns loot without ammo attached, use addLoot() if you want the respective ammo to drop alongside the gun
     */
    addLootWithoutAmmo(
        type: string,
        pos: Vec2,
        layer: number,
        count: number,
        pushSpeed?: number,
        dir?: Vec2,
    ) {
        if (!this.isValidLootType(type)) return;
        const loot = new Loot(this.game, type, pos, layer, count, pushSpeed, dir);
        this._addLoot(loot);
    }

    addLoot(
        type: string,
        pos: Vec2,
        layer: number,
        count: number,
        optionsOrUseCount: AddLootOptions | boolean = {},
        legacyPushSpeed?: number,
        legacyDir?: Vec2,
        legacyPreloadGun?: boolean,
        legacyOneTimePerk?: boolean,
    ) {
        const options: AddLootOptions = typeof optionsOrUseCount === "object"
            ? optionsOrUseCount
            : {
                useCountForAmmo: optionsOrUseCount,
                pushSpeed: legacyPushSpeed,
                dir: legacyDir,
                preloadGun: legacyPreloadGun,
                oneTimePerk: legacyOneTimePerk,
            };
        const {
            useCountForAmmo,
            pushSpeed,
            dir,
            noSideAmmo,
            preloadGun,
            source,
            ownerId,
            ownerExpiresAt,
            oneTimePerk,
        } = options;
        const def = GameObjectDefs.typeToDef(type);

        if (!("lootImg" in def)) {
            this.game.logger.warn("Invalid loot type:", type);
            return;
        }

        const loot = new Loot(
            this.game,
            type,
            pos,
            layer,
            count,
            pushSpeed,
            dir,
            ownerId,
        );
        if (ownerExpiresAt) loot.ownerExpiresAt = ownerExpiresAt;
        if (oneTimePerk) loot.oneTimePerk = true;
        this._addLoot(loot);

        if (noSideAmmo) return;

        if (
            def.type === "gun"
            && preloadGun
            && !def.ammoInfinite
            && source !== "player"
        ) {
            loot.isPreloadedGun = true;
        }

        if (def.type === "gun" && GameObjectDefs.typeExists(def.ammo) && !loot.isPreloadedGun) {
            let ammoCount = useCountForAmmo ? count : def.ammoSpawnCount;
            if (
                Boolean(this.game.map.mapDef.gameMode.extractionMode)
                && ammoCount > 0
            ) {
                // 搜打撤（普通 + 绝密）：伴随武器掉落的弹药同样按规则缩减，
                // 与 lootTable 生成的独立弹药保持一致，避免"只降了弹药箱、没降武器弹药"。
                ammoCount = extractionAmmoCount(def.ammo, ammoCount);
            }
            if (ammoCount <= 0) return;
            const halfAmmo = Math.ceil(ammoCount / 2);

            const leftAmmo = new Loot(
                this.game,
                def.ammo,
                v2.add(pos, v2.create(-AMMO_OFFSET_X, AMMO_OFFSET_Y)),
                layer,
                halfAmmo,
                pushSpeed,
                dir,
                ownerId,
            );
            this._addLoot(leftAmmo);

            if (ammoCount - halfAmmo >= 1) {
                const rightAmmo = new Loot(
                    this.game,
                    def.ammo,
                    v2.add(pos, v2.create(AMMO_OFFSET_X, AMMO_OFFSET_Y)),
                    layer,
                    ammoCount - halfAmmo,
                    pushSpeed,
                    dir,
                    ownerId,
                );
                this._addLoot(rightAmmo);
            }
        }
    }

    /**
     * Should be called in events of obstacles changing their collider, spawning, regrowing etc
     * Be careful to not call it too often
     */
    forceLootUpdates(collider: Collider, layer: number) {
        const loots = this.game.grid.intersectCollider(collider);
        for (let i = 0; i < loots.length; i++) {
            const obj = loots[i];
            if (obj.__type === ObjectType.Loot && util.sameLayer(obj.layer, layer)) {
                obj.forceUpdate = true;
            }
        }
    }

    private _addLoot(loot: Loot) {
        this.stabilizeSpawnPosition(loot);
        this.game.objectRegister.register(loot);
        this.loots.push(loot);
        this.newLoots.push(loot);
    }

    private stabilizeSpawnPosition(loot: Loot): void {
        const original = v2.copy(loot.pos);
        for (let pass = 0; pass < 6; pass++) {
            let moved = false;
            const objects = this.game.grid.intersectCollider(loot.collider);
            for (const object of objects) {
                if (
                    object.__type !== ObjectType.Obstacle
                    || !object.collidable
                    || object.dead
                    || !util.sameLayer(object.layer, loot.layer)
                ) {
                    continue;
                }
                const collision = collider.intersectCircle(
                    object.collider,
                    loot.pos,
                    loot.rad,
                );
                if (!collision) continue;
                v2.set(
                    loot.pos,
                    v2.add(loot.pos, v2.mul(collision.dir, collision.pen + 0.01)),
                );
                moved = true;
            }
            this.game.map.clampToMapBounds(loot.pos, loot.rad);
            if (!moved) break;
        }

        if (!this.spawnPositionBlocked(loot)) return;
        // Dense rooms can leave the iterative push trapped between multiple walls.
        // Search outward before registering the object so clients never receive an
        // unreachable item on the far side of a wall.
        for (let ring = 1; ring <= 4; ring++) {
            const radius = ring * Math.max(0.7, loot.rad * 1.7);
            for (let i = 0; i < 24; i++) {
                const angle = (Math.PI * 2 * i) / 24;
                v2.set(
                    loot.pos,
                    v2.add(original, v2.create(Math.cos(angle) * radius, Math.sin(angle) * radius)),
                );
                this.game.map.clampToMapBounds(loot.pos, loot.rad);
                if (!this.spawnPositionBlocked(loot)) return;
            }
        }
        v2.set(loot.pos, original);
        this.game.map.clampToMapBounds(loot.pos, loot.rad);
    }

    private spawnPositionBlocked(loot: Loot): boolean {
        for (const object of this.game.grid.intersectCollider(loot.collider)) {
            if (
                object.__type !== ObjectType.Obstacle
                || !object.collidable
                || object.dead
                || !util.sameLayer(object.layer, loot.layer)
            ) {
                continue;
            }
            if (collider.intersectCircle(object.collider, loot.pos, loot.rad)) return true;
        }
        return false;
    }

    private isValidLootType(type: unknown, warn = true): type is string {
        const def = typeof type === "string" && type.length > 0
            ? GameObjectDefs.typeToDefSafe(type)
            : undefined;
        const valid = Boolean(def && "lootImg" in def);
        if (!valid && warn) {
            const key = String(type ?? "<undefined>");
            if (!this._warnedInvalidLoot.has(key)) {
                this._warnedInvalidLoot.add(key);
                this.game.logger.warn(`Skipping invalid loot type ${key}`);
            }
        }
        return valid;
    }

    private _getLootTable(
        tier: string,
        options: LootRollOptions = {},
    ): LootTierItem | undefined {
        const applyExtractionSecretBonus = options.applyExtractionSecretBonus !== false;
        const cacheKey = `${tier}|secret-bonus:${applyExtractionSecretBonus ? 1 : 0}`;
        if (this._cachedTiers[cacheKey]) {
            return this._cachedTiers[cacheKey]();
        }
        const lootTable = this.game.map.mapDef.lootTable[tier];
        if (!Array.isArray(lootTable) || lootTable.length === 0) return undefined;

        const extractionMode = Boolean(
            this.game.map.mapDef.gameMode.extractionMode,
        );
        const secretMode = extractionMode && this.game.extractionSecretEnabled;
        const weightedItems = lootTable
            .filter((item) => Number.isFinite(item.weight) && item.weight > 0)
            .map((item) => {
                const weight = extractionLootWeight(
                    item.name,
                    item.weight,
                    extractionMode,
                    secretMode,
                    applyExtractionSecretBonus,
                );
                return weight === item.weight ? item : { ...item, weight };
            });
        if (weightedItems.length === 0) return undefined;

        let total = 0.0;
        for (let i = 0; i < weightedItems.length; i++) {
            total += weightedItems[i].weight;
        }

        function fn() {
            let rng = util.random(0, total);
            let idx = 0;
            while (idx < weightedItems.length - 1 && rng > weightedItems[idx].weight) {
                rng -= weightedItems[idx].weight;
                idx++;
            }
            return weightedItems[idx];
        }
        this._cachedTiers[cacheKey] = fn;
        return fn();
    }

    getLootTable(
        tier: string,
        visited = new Set<string>(),
        options: LootRollOptions = {},
    ): LootTierItem | undefined {
        if (!this.game.map.mapDef.lootTable[tier]) {
            this.game.logger.warn(`Unknown loot tier with type ${tier}`);
            return undefined;
        }
        if (visited.has(tier)) {
            this.game.logger.warn(`Circular loot tier reference ${[...visited, tier].join(" -> ")}`);
            return undefined;
        }
        visited.add(tier);

        const item = this._getLootTable(tier, options);
        if (!item || !item.name) return undefined;

        if (item.name.startsWith("tier_")) {
            return this.getLootTable(item.name, visited, options);
        }

        if (!this.isValidLootType(item.name)) return undefined;
        const count = Boolean(this.game.map.mapDef.gameMode.extractionMode)
                && Number.isFinite(item.count)
            ? extractionAmmoCount(item.name, item.count ?? 0)
            : item.count;
        return count === item.count ? item : { ...item, count };
    }
}

export class Loot extends BaseGameObject {
    override readonly __type = ObjectType.Loot;
    bounds: AABB;

    isPreloadedGun = false;

    get hasOwner() {
        return this.ownerId !== 0;
    }
    ownerId = 0;
    removeOwnerTicker = 0;
    ownerExpiresAt = 0;
    isOld = false;
    /** 一次性技能掉落：被其他玩家拾取后也只能在局内使用，撤离不带回仓库。 */
    oneTimePerk = false;

    forceUpdate = true;

    layer: number;
    type: string;
    count: number;

    vel = v2.create(0, 0);
    // last position sent to clients
    // used to check when to set the loot to dirty
    lastClientPos = v2.create(0, 0);

    collider: Circle;
    rad: number;

    bellowBridge = false;

    mapIndicator?: MapIndicator;

    lootRad: number;

    constructor(
        game: Game,
        type: string,
        pos: Vec2,
        layer: number,
        count: number,
        pushSpeed = 4.75,
        dir?: Vec2,
        ownerId?: number,
    ) {
        super(game, pos);

        const def = GameObjectDefs.typeToDef(type) as LootDef;
        assert("lootImg" in def, `Invalid loot type ${type}`);

        this.layer = layer;
        this.type = type;
        this.count = def.type === "gun" ? 1 : count;
        this.ownerId = ownerId ?? 0;

        this.collider = collider.createCircle(pos, GameConfig.lootRadius[def.type]);
        this.collider.pos = this.pos;

        this.rad = this.collider.rad;
        // apparently original surviv loots had an extended hitbox
        // that was only used for loot to loot collision...
        // this seems to match it from the recorded packets
        this.lootRad = this.rad * 1.25;

        this.bounds = collider.createAabbExtents(
            v2.create(0, 0),
            v2.create(this.rad, this.rad),
        );

        if ("mapIndicator" in def) {
            this.mapIndicator = this.game.mapIndicatorBarn.allocIndicator(
                this.type,
                false,
            );
            this.mapIndicator?.updatePosition(this.pos);
        }

        this.pushLoot(dir ?? v2.randomUnit(), pushSpeed);
    }

    updatePos(newPos: Vec2): void {
        v2.set(this.pos, newPos);
        this.game.map.clampToMapBounds(this.pos, this.rad);
        this.setPartDirty();
    }

    refresh(): void {
        this.collider.pos = this.pos;
        this.game.grid.updateObject(this);
    }

    update(dt: number): void {
        if (releaseExpiredLootOwner(this, Date.now())) {
            this.setDirty();
        }

        if (this.hasOwner) {
            const owner = this.game.objectRegister.getById(this.ownerId);
            this.removeOwnerTicker += dt;
            if (
                (this.ownerExpiresAt <= 0 && this.removeOwnerTicker > 2)
                || !owner
                || (owner.__type === ObjectType.Player && (owner.dead || owner.disconnected))
            ) {
                this.ownerId = 0;
                this.ownerExpiresAt = 0;
                this.setDirty();
            }
        }

        // make loots "sleep" if they are not moving
        // `forceUpdate` is set when obstacles around the loot change their colliders
        const shouldUpdate = this.forceUpdate
            || !v2.eq(this.vel, v2.create(0, 0), 0.01)
            || !v2.eq(this.lastClientPos, this.pos, 0.01);

        if (!shouldUpdate) {
            return;
        }
        this.forceUpdate = false;

        v2.set(this.vel, v2.mul(this.vel, 1 / (1 + dt * 2.5)));
        v2.set(this.pos, v2.add(this.pos, v2.mul(this.vel, dt)));

        const originalLayer = this.layer;

        let finalStair: Structure["stairs"][0] | undefined;

        // find a ground surface
        // used to check if e.g we are above a bridge
        // to ignore rivers
        // most of this logic was copied from map.getGroundSurface
        // but optimized for loot and to only do a single loop
        let surface = {
            type: "",
            zIdx: 0,
        };

        const onStairs = this.layer & 0x2;

        let objs = this.game.grid.intersectGameObject(this);
        for (let i = 0; i < objs.length; i++) {
            const obj = objs[i];

            switch (obj.__type) {
                case ObjectType.Obstacle: {
                    if (!obj.collidable) continue;
                    if (!util.sameLayer(obj.layer, this.layer)) continue;
                    if (obj.dead) continue;

                    const collision = collider.intersectCircle(
                        obj.collider,
                        this.pos,
                        this.rad,
                    );
                    if (collision) {
                        v2.set(
                            this.pos,
                            v2.add(
                                this.pos,
                                v2.mul(collision.dir, collision.pen + 0.001),
                            ),
                        );
                    }
                    break;
                }
                case ObjectType.Building: {
                    // if we are bellow a bridge we need to ignore surfaces
                    // so the loot keeps flowing on the river
                    if (this.bellowBridge) continue;
                    // Prioritize layer0 building surfaces when on stairs
                    if (
                        (obj.layer !== this.layer && !onStairs)
                        || (obj.layer === 1 && onStairs)
                    ) {
                        continue;
                    }
                    if (surface.zIdx > obj.zIdx) continue;

                    for (let j = 0; j < obj.surfaces.length; j++) {
                        const objSurf = obj.surfaces[j];
                        for (let k = 0; k < objSurf.colliders.length; k++) {
                            if (coldet.test(objSurf.colliders[k], this.collider)) {
                                surface = {
                                    type: objSurf.type,
                                    zIdx: obj.zIdx,
                                };
                                break;
                            }
                        }
                    }
                    break;
                }
                case ObjectType.Decal: {
                    if (this.bellowBridge) continue;
                    if (!obj.collider || !obj.surface) continue;
                    if (!util.sameLayer(obj.layer, this.layer)) continue;
                    if (!coldet.test(obj.collider, this.collider)) continue;
                    // decal surfaces have priority
                    surface = {
                        type: obj.surface,
                        zIdx: 9999999,
                    };
                    break;
                }
                case ObjectType.Structure: {
                    finalStair = this.checkStructureStairs(obj, this.rad);
                    break;
                }
            }
        }

        if (this.layer === 0) {
            this.bellowBridge = false;
        }

        if (finalStair?.lootOnly) {
            this.bellowBridge = true;
        }

        let finalRiver: River | undefined;
        // ignore rivers if we are in the ocean
        const beachAABB = this.game.map.beachBounds;
        if (
            !surface.type
            && coldet.testPointAabb(this.pos, beachAABB.min, beachAABB.max)
        ) {
            const rivers = this.game.map.normalRivers;
            for (let i = 0; i < rivers.length; i++) {
                const river = rivers[i];
                if (
                    coldet.testPointAabb(this.pos, river.aabb.min, river.aabb.max)
                    && math.pointInsidePolygon(this.pos, river.waterPoly)
                ) {
                    finalRiver = river;
                    break;
                }
            }
        }

        if (finalRiver) {
            const tangent = finalRiver.spline.getTangent(
                finalRiver.spline.getClosestTtoPoint(this.pos),
            );
            this.pushLoot(tangent, 0.5 * dt);
        }

        if (this.layer !== originalLayer) {
            this.setDirty();
        }

        if (!v2.eq(this.lastClientPos, this.pos, 0.01)) {
            this.setPartDirty();
            this.game.grid.updateObject(this);
            this.mapIndicator?.updatePosition(this.pos);
            v2.set(this.lastClientPos, this.pos);
        }

        this.game.map.clampToMapBounds(this.pos, this.rad);
    }

    pushLoot(dir: Vec2, velocity: number): void {
        v2.set(this.vel, v2.add(this.vel, v2.mul(dir, velocity)));
    }

    override destroy() {
        super.destroy();
        this.mapIndicator?.kill();
    }
}
