import { randomInt } from "node:crypto";
import { GearDefs } from "../../../shared/defs/gameObjects/gearDefs.ts";
import { baseGunOf, GunDefs } from "../../../shared/defs/gameObjects/gunDefs.ts";
import { MeleeDefs } from "../../../shared/defs/gameObjects/meleeDefs.ts";
import { PerkDefs } from "../../../shared/defs/gameObjects/perkDefs.ts";
import { ThrowableDefs } from "../../../shared/defs/gameObjects/throwableDefs.ts";
import { Config, refreshShopConfigFromDisk } from "../config.ts";
import { getDuelWeaponTier, type DuelWeaponTier } from "../duelWeapons.ts";
import { stackCap, type StashCategory, stashCategoryFor, stashManager } from "../stash/stashManager.ts";

/**
 * 搜打撤经济系统：商店购买/出售。
 *
 * 规则：
 * - 特殊头盔和四级护甲进入后台目录，但默认关闭买卖，避免意外上架；
 * - 占位、彩蛋、模式内部弹药等非商品不出现；
 * - S/S+ 武器、信号弹（flare）、信号枪（flare_gun）、AWM 子弹（308sub）
 *   默认不允许购买、只允许出售，后台可逐物品调整购买/出售开关；
 * - 近战武器允许购买，默认定价 1000，出售价不变（仍按默认价一半）；
 * - 每个物品有默认定价，后台可逐物品覆盖（Config.shop.prices）。
 */

/** 排除：不是可持有商品的内部对象（商店不显示，也不能交易）。 */
const EXCLUDED_TYPES = new Set([
    // 占位 / 彩蛋 / 默认派发
    "backpack00",
    "m9_cursed",
    "fists",
    "1xscope",
    // 模式 / 活动专属武器与弹药
    "potato_cannon",
    "potato_smg",
    "bugle",
    "potato_ammo",
    // 投掷物内部派生物（玩家不能作为背包物品持有）
    "mirv_mini",
    "martyr_nade",
    "snowball_heavy",
    "potato_heavy",
    // 枪械弹丸 / 地图轰炸投射物
    "potato_cannonball",
    "potato_smgshot",
    "potato_lmgshot",
    "bomb_iron",
]);

/** 只允许三种普通等级头盔，模式/职业/外观头盔一律不交易。 */
const TRADABLE_HELMETS = new Set(["helmet01", "helmet02", "helmet03"]);

/** 投掷物交易白名单；IR Strobe 另限制为仅出售。 */
const TRADABLE_THROWABLES = new Set(["frag", "smoke", "mirv", "strobe"]);

/** 后台也不得开启购买的硬性仅售商品。 */
const HARD_SELL_ONLY_TYPES = new Set(["strobe"]);

/** 后台可配置但默认不开放交易的特殊装备。 */
const DEFAULT_DISABLED_TYPES = new Set([
    "helmet04",
    "chest04",
    "helmet03_leader",
    "helmet03_forest",
    "helmet03_moon",
    "helmet03_lt",
    "helmet03_lt_aged",
    "helmet03_potato",
    "helmet03_marksman",
    "helmet03_recon",
    "helmet03_grenadier",
    "helmet03_bugler",
    "helmet04_medic",
    "helmet04_last_man_red",
    "helmet04_last_man_blue",
    "helmet04_leader",
]);

/** 仅出售（不可购买）的特殊物品。 */
const SELL_ONLY_SPECIAL = new Set(["flare", "flare_gun", "308sub", "strobe"]);

/** 仅出售物品的默认出售价。 */
const SELL_ONLY_PRICES: Record<string, number> = {
    flare: 150,
    flare_gun: 500,
    "308sub": 15,
    strobe: 250,
};

/** 弹药默认价（每发）。 */
const AMMO_PRICES: Record<string, number> = {
    "9mm": 2,
    "45acp": 2,
    "12gauge": 3,
    "556mm": 3,
    "762mm": 3,
    "50AE": 4,
    "308sub": 15,
    flare: 150,
};

/** 药品 / 增益默认价（每个）。 */
const CONSUMABLE_PRICES: Record<string, number> = {
    bandage: 10,
    healthkit: 60,
    soda: 25,
    painkiller: 40,
};

/** 投掷物默认价（每个）。 */
const THROWABLE_PRICES: Record<string, number> = {
    frag: 40,
    smoke: 30,
    mirv: 160,
    strobe: 500,
    snowball: 10,
    potato: 10,
    coconut: 20,
    tomato: 10,
};

/** 近战默认价（每个）。 */
const MELEE_PRICES: Record<string, number> = {
    knuckles: 30,
    karambit: 60,
    bayonet: 60,
    huntsman: 70,
    bowie: 50,
    machete: 70,
    saw: 60,
    woodaxe: 70,
    fireaxe: 90,
    katana: 200,
    naginata: 160,
    stonehammer: 120,
    hook: 80,
    pan: 100,
    spade: 90,
    crowbar: 110,
};

/** 枪械等级兜底买入价（新增枪械未列入逐枪价格时使用）。 */
const GUN_TIER_BUY_PRICES: Record<string, number> = {
    "S+": 4000,
    S: 2500,
    A: 1500,
    B: 600,
    C: 300,
    D: 150,
};

/** 新版本枪械尚未进入旧 1v1 分级表，商店独立补齐强度等级。 */
const SHOP_GUN_TIER_OVERRIDES: Partial<Record<string, DuelWeaponTier>> = {
    potato_lmg: "S+", // PMG-134：土豆空投无限弹药机枪
    ash12: "S+",
    spas16: "S",
    barrett: "S",
    sw500: "A",
    imbel: "B",
};

/** 只更换外观的季节枪械继承本体的价格和交易限制。 */
const SHOP_GUN_VARIANT_BASES: Partial<Record<string, string>> = {
    svd_winter: "svd",
    sv98_winter: "sv98",
    awc_winter: "awc",
};

function shopGunBase(type: string): string {
    return SHOP_GUN_VARIANT_BASES[type] ?? type;
}

function shopGunTier(type: string): DuelWeaponTier | null {
    const base = shopGunBase(type);
    return SHOP_GUN_TIER_OVERRIDES[base] ?? getDuelWeaponTier(base);
}

/**
 * 枪械建议价：在模式现有 S+~D 分级基础上，再结合伤害、DPS、射程、
 * 容错率与稀有度逐枪细分。S/S+ 仍默认仅可出售，此价格同时作为后台
 * 手动开启购买时的建议价；未列入的新枪会回退到上方等级价。
 */
const GUN_RANKED_BUY_PRICES: Record<string, number> = {
    // S+
    awc: 5200,
    potato_lmg: 5000,
    ash12: 4800,
    m1014: 4600,
    usas: 4400,
    // S
    spas16: 3600,
    m249: 3500,
    barrett: 3400,
    sv98: 3300,
    m4a1: 3200,
    scarssr: 3100,
    saiga: 2800,
    spas12: 2700,
    mosin: 2600,
    // A
    pkp: 2200,
    scar: 2100,
    sw500: 2000,
    l86: 1900,
    grozas: 1900,
    qbb97: 1850,
    svd: 1850,
    an94: 1800,
    mp220: 1800,
    vector45: 1800,
    bar: 1750,
    vector: 1750,
    groza: 1700,
    garand: 1700,
    scorpion: 1700,
    mkg45: 1650,
    deagle: 1650,
    p30l: 1550,
    // B
    hk416: 950,
    ak47: 900,
    famas: 850,
    mac10: 850,
    mk12: 850,
    m870: 800,
    imbel: 800,
    vss: 800,
    m1a1: 750,
    m39: 750,
    ots38: 750,
    colt45: 700,
    dp28: 700,
    mp5: 700,
    scout_elite: 700,
    blr: 650,
    m1100: 650,
    ump9: 500,
    // C/D
    glock: 450,
    m93r: 425,
    model94: 400,
    m1911: 350,
    ot38: 300,
    m9: 150,
};

/** 护甲按等级默认价（头盔 / 胸甲 / 背包同价）。 */
const ARMOR_LEVEL_PRICES: Record<number, number> = {
    1: 120,
    2: 450,
    3: 1200,
};

/** 倍镜默认价。 */
const SCOPE_PRICES: Record<string, number> = {
    "2xscope": 150,
    "4xscope": 500,
    "8xscope": 1500,
    "15xscope": 3000,
};

export interface ShopItem {
    type: string;
    category: StashCategory;
    name: string;
    /** 买入价；null 表示不可购买。 */
    buy: number | null;
    /** 卖出价；null 表示不可出售。 */
    sell: number | null;
    buyEnabled: boolean;
    sellEnabled: boolean;
    sellOnly: boolean;
}

export interface ShopCatalog {
    coins: number;
    items: Array<ShopItem & { owned: number }>;
    /** 一次性能力（仅限一局）定价。 */
    oneTimePerkPrice?: number;
    /** 一次性能力可购目录（owned 为仓库持有数量）。 */
    oneTimePerks?: ReturnType<typeof oneTimePerkCatalog>["items"];
}

/** 是否属于"仅出售"：S/S+ 武器或特殊仅出售物品。 */
function isSellOnly(type: string): boolean {
    if (SELL_ONLY_SPECIAL.has(type)) return true;
    if (stashCategoryFor(type) === "guns") {
        const tier = shopGunTier(type);
        return tier === "S" || tier === "S+";
    }
    return false;
}

function defaultBuyEnabled(type: string): boolean {
    return !DEFAULT_DISABLED_TYPES.has(type) && !isSellOnly(type);
}

function defaultSellEnabled(type: string, category: StashCategory): boolean {
    return !DEFAULT_DISABLED_TYPES.has(type) && defaultSellPrice(type, category) !== null;
}

/** 商品的建议买入价；即使默认禁止购买，也保留建议价供后台启用时使用。 */
function defaultBuyPrice(type: string, category: StashCategory): number | null {
    // 近战武器允许购买，默认定价 1000（出售价不变）。
    if (category === "melee") return 1000;
    const def = GameObjectDef(type);
    switch (category) {
        case "guns": {
            const base = shopGunBase(type);
            const tier = shopGunTier(type) ?? "D";
            return GUN_RANKED_BUY_PRICES[base] ?? GUN_TIER_BUY_PRICES[tier] ?? 100;
        }
        case "ammo":
            return AMMO_PRICES[type] ?? 2;
        case "consumables":
            return CONSUMABLE_PRICES[type] ?? 10;
        case "throwables":
            return THROWABLE_PRICES[type] ?? 40;
        case "helmets":
        case "chests":
        case "backpacks":
            return ARMOR_LEVEL_PRICES[def?.level ?? 1] ?? 80;
        case "scopes":
            return SCOPE_PRICES[type] ?? 100;
        default:
            return null;
    }
}

function defaultSellPrice(type: string, category: StashCategory): number | null {
    if (isSellOnly(type)) {
        if (stashCategoryFor(type) === "guns") {
            const base = shopGunBase(type);
            const tier = shopGunTier(type) ?? "S";
            const buy = GUN_RANKED_BUY_PRICES[base] ?? GUN_TIER_BUY_PRICES[tier] ?? 1200;
            return Math.floor(buy * 0.5);
        }
        return SELL_ONLY_PRICES[type] ?? 50;
    }
    // 近战：仅出售，按近战默认价的一半出售。
    if (category === "melee") {
        return Math.max(1, Math.floor((MELEE_PRICES[type] ?? 50) * 0.5));
    }
    const buy = defaultBuyPrice(type, category);
    if (buy === null) return null;
    return Math.max(1, Math.floor(buy * 0.5));
}

function GameObjectDef(type: string) {
    return (
        (GunDefs as Record<string, { level?: number }>)[type]
            ?? (GearDefs as Record<string, { level?: number }>)[type]
            ?? (MeleeDefs as Record<string, { level?: number }>)[type]
            ?? (ThrowableDefs as Record<string, { level?: number }>)[type]
            ?? undefined
    );
}

/** 名称（中文优先用游戏内名称，兜底用类型 id）。 */
function itemName(type: string): string {
    const def = GameObjectDef(type) as { name?: string } | undefined;
    return def?.name || type;
}

function isExcluded(type: string): boolean {
    if (EXCLUDED_TYPES.has(type)) return true;
    const category = stashCategoryFor(type);
    if (category === "helmets" && !TRADABLE_HELMETS.has(type)) return true;
    if (category === "throwables" && !TRADABLE_THROWABLES.has(type)) return true;
    // 能力（perk）不在商店出售/购买。
    if (category === "perks") return true;
    return false;
}

/** 配装中占用（已装备/携带）的数量：这部分不能出售。 */
function equippedCount(name: string, type: string): number {
    const loadout = stashManager.getStash(name).loadout;
    if (!loadout) return 0;
    const category = stashCategoryFor(type);
    switch (category) {
        case "guns": {
            let count = 0;
            for (const gun of loadout.guns ?? []) {
                if (gun === type) count += 1;
                else if (baseGunOf(gun) === type) count += 2; // 双持占两把
            }
            return count;
        }
        case "ammo":
            return Math.max(0, Number(loadout.ammo?.[type] ?? 0));
        case "consumables":
            return Math.max(0, Number(loadout.consumables?.[type] ?? 0));
        case "throwables":
            return Math.max(0, Number(loadout.throwables?.[type] ?? 0));
        case "melee":
            return loadout.melee === type ? 1 : 0;
        case "helmets":
            return loadout.armor?.helmet === type ? 1 : 0;
        case "chests":
            return loadout.armor?.chest === type ? 1 : 0;
        case "backpacks":
            return loadout.armor?.backpack === type ? 1 : 0;
        case "scopes":
            return loadout.armor?.scope === type ? 1 : 0;
        default:
            return 0;
    }
}

/** 商店候选类型：枪械（base，去 _dual）、弹药、药品、投掷物、近战、护甲、倍镜。 */
function catalogTypes(): string[] {
    const types = new Set<string>();
    for (const type of Object.keys(GunDefs)) {
        if (type.endsWith("_dual")) continue;
        types.add(type);
    }
    for (const type of Object.keys(GearDefs)) {
        const category = stashCategoryFor(type);
        if (
            category === "ammo"
            || category === "consumables"
            || category === "helmets"
            || category === "chests"
            || category === "backpacks"
            || category === "scopes"
        ) {
            types.add(type);
        }
    }
    for (const type of Object.keys(MeleeDefs)) {
        types.add(type);
    }
    for (const type of Object.keys(ThrowableDefs)) {
        if (stashCategoryFor(type) === "throwables") types.add(type);
    }
    return [...types].filter((type) => !isExcluded(type));
}

function effectiveBuyPrice(type: string, category: StashCategory): number | null {
    if (HARD_SELL_ONLY_TYPES.has(type)) return null;
    const override = Config.shop.prices?.[type];
    // 显式开关优先；旧配置的 null 仍兼容为关闭。其余沿用默认规则。
    const enabled = typeof override?.buyEnabled === "boolean"
        ? override.buyEnabled
        : override?.buy === null
        ? false
        : defaultBuyEnabled(type);
    if (!enabled) return null;
    if (override && typeof override.buy !== "undefined") {
        // buyEnabled=true 可覆盖旧的 buy:null，并回落到建议价。
        if (override.buy === null) return defaultBuyPrice(type, category);
        const value = Math.max(0, Math.floor(Number(override.buy) || 0));
        return value > 0 ? value : null;
    }
    return defaultBuyPrice(type, category);
}

function effectiveSellPrice(type: string, category: StashCategory): number | null {
    const override = Config.shop.prices?.[type];
    const enabled = typeof override?.sellEnabled === "boolean"
        ? override.sellEnabled
        : override?.sell === null
        ? false
        : defaultSellEnabled(type, category);
    if (!enabled) return null;
    if (override && typeof override.sell !== "undefined") {
        // sellEnabled=true 可覆盖旧的 sell:null，并回落到建议价。
        if (override.sell === null) return defaultSellPrice(type, category);
        const value = Math.max(0, Math.floor(Number(override.sell) || 0));
        return value > 0 ? value : null;
    }
    return defaultSellPrice(type, category);
}

/** 商店目录：物品 + 玩家余额 + 已拥有数量。 */
export function getShopCatalog(name: string): ShopCatalog {
    refreshShopConfigFromDisk();
    const stash = stashManager.getStash(name);
    const items: ShopCatalog["items"] = catalogTypes()
        .map((type) => {
            const category = stashCategoryFor(type) as StashCategory;
            const buy = effectiveBuyPrice(type, category);
            const sell = effectiveSellPrice(type, category);
            return {
                type,
                category,
                name: itemName(type),
                buy,
                sell,
                buyEnabled: buy !== null,
                sellEnabled: sell !== null,
                sellOnly: buy === null && sell !== null,
                owned: Math.max(0, Number(stash.items[category]?.[type] ?? 0)),
            };
        })
        // 后台两个开关都关闭的物品不应出现在玩家商场；后台目录仍保留它。
        .filter((item) => item.buyEnabled || item.sellEnabled);
    // 按类别分组顺序 + 类型排序，方便客户端展示。
    const categoryOrder: Record<StashCategory, number> = {
        guns: 0,
        ammo: 1,
        consumables: 2,
        throwables: 3,
        melee: 4,
        helmets: 5,
        chests: 6,
        backpacks: 7,
        scopes: 8,
        perks: 9,
    };
    items.sort(
        (a, b) =>
            (categoryOrder[a.category] ?? 99) - (categoryOrder[b.category] ?? 99)
            || a.type.localeCompare(b.type),
    );
    return {
        coins: Math.max(0, Math.floor(Number(stash.coins) || 0)),
        items,
        oneTimePerkPrice: Math.max(
            0,
            Math.floor(Number(Config.shop.oneTimePerkPrice) || 0),
        ),
        oneTimePerks: oneTimePerkCatalog(name).items,
    };
}

/** 购买：扣金币 + 加仓（受仓库堆叠上限约束，按实际入仓数量收费）。 */
export function shopBuy(
    name: string,
    type: string,
    count = 1,
): { ok: boolean; reason?: string; coins?: number } {
    refreshShopConfigFromDisk();
    const category = stashCategoryFor(type);
    if (!category) return { ok: false, reason: "invalid-item" };
    if (isExcluded(type)) return { ok: false, reason: "not-for-sale" };
    const buy = effectiveBuyPrice(type, category);
    if (buy === null) return { ok: false, reason: "not-for-sale" };

    const amount = Math.max(1, Math.floor(count));
    const stash = stashManager.getStash(name);
    const current = Math.max(0, Number(stash.items[category]?.[type] ?? 0));
    const cap = stackCap(type);
    const actual = Math.min(amount, Math.max(0, cap - current));
    if (actual <= 0) return { ok: false, reason: "stack-full" };
    const total = actual * buy;
    const coins = Math.max(0, Math.floor(Number(stash.coins) || 0));
    if (coins < total) return { ok: false, reason: "not-enough-coins" };

    // 原子交易：加仓 + 扣金币在同一加锁写事务内完成，避免崩溃时不一致。
    const tradeResult = stashManager.atomicTrade(name, {
        add: [{ type, count: actual }],
        coinsDelta: -total,
    });
    if (!tradeResult.ok) return { ok: false, reason: tradeResult.reason };
    return { ok: true, coins: tradeResult.coins };
}

/** 一次性能力（仅限一局）：可购目录及仓库持有数量（允许购买多个同类型）。 */
export function oneTimePerkCatalog(name: string): {
    price: number;
    banned: string[];
    items: Array<{
        type: string;
        name: string;
        banned: boolean;
        /** 仓库持有数量（0 = 未购买）。 */
        owned: number;
    }>;
} {
    refreshShopConfigFromDisk();
    const price = Math.max(0, Math.floor(Number(Config.shop.oneTimePerkPrice) || 0));
    const banned = Array.isArray(Config.shop.oneTimePerkBanned)
        ? [...Config.shop.oneTimePerkBanned]
        : [];
    // 对局中已扣仓、仍在 pending grant 的一次性能力也计入持有数量；
    // 同类型的每一份付费库存都必须独立计数。
    const ownedCounts = stashManager.oneTimePerkOwnedCounts(name);
    const items = Object.keys(PerkDefs)
        .filter((type) => type !== "halloween_mystery")
        .sort()
        .map((type) => ({
            type,
            name: PerkDefs[type].name,
            banned: banned.includes(type),
            owned: ownedCounts[type] ?? 0,
        }));
    return { price, banned, items };
}

/** 购买一次性能力：原子扣金币并存入仓库，不自动装配。 */
export function buyOneTimePerk(
    name: string,
    type: string,
): { ok: boolean; reason?: string; coins?: number; oneTimePerks?: string[] } {
    refreshShopConfigFromDisk();
    const def = PerkDefs[type];
    if (!def) return { ok: false, reason: "invalid-item" };
    if (type === "halloween_mystery") return { ok: false, reason: "not-for-sale" };
    const banned = Array.isArray(Config.shop.oneTimePerkBanned)
        ? Config.shop.oneTimePerkBanned
        : [];
    if (banned.includes(type)) return { ok: false, reason: "not-for-sale" };
    const price = Math.max(0, Math.floor(Number(Config.shop.oneTimePerkPrice) || 0));
    if (price <= 0) return { ok: false, reason: "invalid-price" };
    return stashManager.buyOneTimePerk(name, type, price);
}

/**
 * 永久技能随机合成池。排除拾荒资源技能、万圣节随机入口及负面/活动占位技能，
 * 其余正常永久技能都可作为产物。
 */
export function permanentPerkFusionPool(): string[] {
    const excluded = new Set(["scavenger", "scavenger_adv", "halloween_mystery"]);
    return Object.keys(PerkDefs)
        .filter(
            (type) =>
                !excluded.has(type)
                && !type.startsWith("trick_")
                && !type.startsWith("treat_"),
        )
        .sort();
}

/** 两份仓库永久技能合成为一份随机永久技能。 */
export function fusePermanentPerks(
    name: string,
    materials: readonly string[],
): {
    ok: boolean;
    reason?: string;
    perks?: Record<string, number>;
    resultType?: string;
    resultName?: string;
} {
    if (!Array.isArray(materials) || materials.length !== 2) {
        return { ok: false, reason: "invalid-materials" };
    }
    const normalized = materials.map((type) => String(type ?? "").trim());
    if (
        normalized.some(
            (type) =>
                !PerkDefs[type]
                || type === "halloween_mystery",
        )
    ) {
        return { ok: false, reason: "invalid-materials" };
    }
    const fullPool = permanentPerkFusionPool();
    if (fullPool.length === 0) return { ok: false, reason: "empty-pool" };
    // Prefer a genuinely different result. If a custom server only exposes the
    // two material types, fall back to its full public pool rather than failing.
    const materialSet = new Set(normalized);
    const differentPool = fullPool.filter((type) => !materialSet.has(type));
    const pool = differentPool.length > 0 ? differentPool : fullPool;
    const result = stashManager.fusePermanentPerks(
        name,
        normalized as [string, string],
        pool,
        randomInt,
    );
    if (!result.ok) return result;
    const resultType = result.resultType!;
    return {
        ...result,
        resultName: PerkDefs[resultType]?.name ?? resultType,
    };
}

/** 出售：扣仓 + 加金币。 */
export function shopSell(
    name: string,
    type: string,
    count = 1,
): { ok: boolean; reason?: string; coins?: number } {
    refreshShopConfigFromDisk();
    const category = stashCategoryFor(type);
    if (!category) return { ok: false, reason: "invalid-item" };
    if (isExcluded(type)) return { ok: false, reason: "not-sellable" };
    const sell = effectiveSellPrice(type, category);
    if (sell === null) return { ok: false, reason: "not-sellable" };

    const amount = Math.max(1, Math.floor(count));
    // 不允许出售身上（已装备/携带）的物品：只能卖仓库里的剩余部分。
    const stash = stashManager.getStash(name);
    const owned = Math.max(0, Number(stash.items[category]?.[type] ?? 0));
    if (owned < amount) return { ok: false, reason: "not-enough" };
    const available = Math.max(0, owned - equippedCount(name, type));
    if (amount > available) {
        return { ok: false, reason: "equipped" };
    }
    // 原子交易：扣仓 + 加金币在同一加锁写事务内完成。
    const tradeResult = stashManager.atomicTrade(name, {
        remove: [{ type, count: amount }],
        coinsDelta: amount * sell,
    });
    if (!tradeResult.ok) return { ok: false, reason: tradeResult.reason };
    return { ok: true, coins: tradeResult.coins };
}

/** 后台价格覆盖对象（供管理端展示/保存）。 */
export function shopPriceOverrides(): Record<
    string,
    { buyEnabled?: boolean; sellEnabled?: boolean; buy?: number | null; sell?: number | null }
> {
    refreshShopConfigFromDisk();
    const out: ReturnType<typeof shopPriceOverrides> = {};
    for (const type of catalogTypes()) {
        const override = Config.shop.prices?.[type];
        out[type] = {
            ...(override?.buyEnabled !== undefined
                ? { buyEnabled: override.buyEnabled }
                : {}),
            ...(override?.sellEnabled !== undefined
                ? { sellEnabled: override.sellEnabled }
                : {}),
            ...(override?.buy !== undefined ? { buy: override.buy } : {}),
            ...(override?.sell !== undefined ? { sell: override.sell } : {}),
        };
    }
    return out;
}

/** 后台可编辑的目录（含默认定价，供管理端展示）。 */
export function shopAdminCatalog(): Array<
    ShopItem & {
        defaultBuyEnabled: boolean;
        defaultSellEnabled: boolean;
        defaultBuy: number | null;
        defaultSell: number | null;
    }
> {
    refreshShopConfigFromDisk();
    return catalogTypes().map((type) => {
        const category = stashCategoryFor(type) as StashCategory;
        const buy = effectiveBuyPrice(type, category);
        const sell = effectiveSellPrice(type, category);
        const defaultSell = defaultSellPrice(type, category);
        return {
            type,
            category,
            name: itemName(type),
            buy,
            sell,
            buyEnabled: buy !== null,
            sellEnabled: sell !== null,
            sellOnly: buy === null && sell !== null,
            defaultBuyEnabled: defaultBuyEnabled(type),
            defaultSellEnabled: defaultSellEnabled(type, category),
            defaultBuy: defaultBuyPrice(type, category),
            defaultSell,
        };
    });
}
