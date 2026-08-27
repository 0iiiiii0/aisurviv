import { GunDefs } from "../../shared/defs/gameObjects/gunDefs.ts";

export const DEFAULT_DUEL_WEAPONS: [string, string] = ["m4a1", "mk12"];

const duelWeaponNotes: Partial<Record<string, string>> = {
    flare_gun: "1v1中不会召唤空投",
    flare_gun_dual: "1v1中不会召唤空投",
};

export type DuelWeaponTier = "S+" | "S" | "A" | "B" | "C" | "D";

const duelWeaponTierOrder: Record<DuelWeaponTier, number> = {
    "S+": 0,
    S: 1,
    A: 2,
    B: 3,
    C: 4,
    D: 5,
};

const duelWeaponTiers: Partial<Record<string, DuelWeaponTier>> = {
    // S+
    awc: "S+",
    ash12: "S+",
    m1014: "S+", // Super 90
    potato_cannon: "S+",
    potato_lmg: "S+", // PMG-134
    usas: "S+",

    // S
    barrett: "S",
    m4a1: "S",
    m249: "S",
    mosin: "S",
    potato_smg: "S",
    saiga: "S",
    scarssr: "S", // Mk 20 SSR
    spas12: "S",
    spas16: "S",
    sv98: "S",

    // A
    an94: "A",
    bar: "A",
    deagle: "A",
    garand: "A",
    groza: "A",
    grozas: "A",
    l86: "A",
    mkg45: "A",
    mp220: "A",
    p30l: "A",
    pkp: "A",
    qbb97: "A",
    scar: "A",
    scorpion: "A",
    svd: "A",
    sw500: "A",
    vector: "A",
    vector45: "A",

    // B
    ak47: "B",
    blr: "B",
    colt45: "B",
    dp28: "B",
    famas: "B",
    hk416: "B",
    imbel: "B", // IMD-2
    m1a1: "B",
    m1100: "B",
    m39: "B",
    m870: "B",
    mac10: "B",
    mk12: "B",
    mp5: "B",
    ots38: "B",
    scout_elite: "B",
    ump9: "B",
    vss: "B",

    // C
    glock: "C",
    m1911: "C",
    m93r: "C",
    model94: "C",
    ot38: "C",

    // D
    m9: "D",
    m9_cursed: "D",
};

const dualWeaponBases: Partial<Record<string, string>> = {
    colt45_dual: "colt45",
    deagle_dual: "deagle",
    glock_dual: "glock",
    m1911_dual: "m1911",
    m93r_dual: "m93r",
    m9_dual: "m9",
    ot38_dual: "ot38",
    ots38_dual: "ots38",
    p30l_dual: "p30l",
};

const duelWeaponDisplayNames: Partial<Record<string, string>> = {
    m1014: "Super 90",
    scarssr: "Mk 20 SSR",
};

export function getDuelWeaponTier(id: string): DuelWeaponTier | null {
    const baseId = dualWeaponBases[id] ?? id;
    return duelWeaponTiers[baseId] ?? null;
}

const weaponCategories = [
    {
        id: "assault_rifle",
        name: "突击步枪",
        weapons: [
            "famas",
            "hk416",
            "m4a1",
            "ak47",
            "scar",
            "an94",
            "groza",
            "grozas",
            "ash12",
        ],
    },
    {
        id: "marksman_rifle",
        name: "射手步枪",
        weapons: ["vss", "mk12", "l86", "scarssr", "model94", "mkg45", "m39", "svd", "garand"],
    },
    {
        id: "sniper_rifle",
        name: "狙击步枪",
        weapons: ["scout_elite", "blr", "mosin", "sv98", "awc", "barrett"],
    },
    {
        id: "submachine_gun",
        name: "冲锋枪",
        weapons: ["mp5", "mac10", "ump9", "vector", "vector45", "scorpion", "m1a1", "potato_smg"],
    },
    {
        id: "light_machine_gun",
        name: "轻机枪",
        weapons: ["m249", "qbb97", "dp28", "bar", "pkp", "imbel", "potato_lmg"],
    },
    {
        id: "shotgun",
        name: "霰弹枪",
        weapons: ["m870", "m1100", "mp220", "saiga", "spas12", "spas16", "m1014", "usas"],
    },
    {
        id: "pistol",
        name: "手枪",
        weapons: [
            "m9",
            "m9_dual",
            "m9_cursed",
            "m93r",
            "m93r_dual",
            "glock",
            "glock_dual",
            "p30l",
            "p30l_dual",
            "ot38",
            "ot38_dual",
            "ots38",
            "ots38_dual",
            "colt45",
            "colt45_dual",
            "m1911",
            "m1911_dual",
            "deagle",
            "deagle_dual",
            "sw500",
        ],
    },
    {
        id: "special",
        name: "特殊武器",
        weapons: ["flare_gun", "flare_gun_dual", "potato_cannon", "bugle"],
    },
] as const;

const categoryByWeapon = new Map<string, { id: string; name: string; order: number }>();
for (let order = 0; order < weaponCategories.length; order++) {
    const category = weaponCategories[order];
    for (const weapon of category.weapons) {
        categoryByWeapon.set(weapon, { id: category.id, name: category.name, order });
    }
}

export function isDuelWeapon(value: unknown): value is string {
    return typeof value === "string" && Boolean(GunDefs[value]);
}

export function normalizeDuelWeapons(value: unknown): [string, string] {
    const configured = Array.isArray(value) ? value : [];
    return [
        isDuelWeapon(configured[0]) ? configured[0] : DEFAULT_DUEL_WEAPONS[0],
        isDuelWeapon(configured[1]) ? configured[1] : DEFAULT_DUEL_WEAPONS[1],
    ];
}

export function getDuelWeaponCatalog() {
    return Object.entries(GunDefs)
        .map(([id, definition]) => {
            const category = categoryByWeapon.get(id) ?? {
                id: "special",
                name: "特殊武器",
                order: weaponCategories.length - 1,
            };
            return {
                id,
                name: duelWeaponDisplayNames[id] ?? definition.name,
                ammo: definition.ammo,
                category: category.id,
                categoryName: category.name,
                categoryOrder: category.order,
                image: `/img/loot/${definition.lootImg.sprite.replace(/\.img$/, ".svg")}`,
                note: duelWeaponNotes[id] ?? null,
                tier: getDuelWeaponTier(id),
            };
        })
        .sort(
            (a, b) =>
                a.categoryOrder - b.categoryOrder
                || (a.tier ? duelWeaponTierOrder[a.tier] : Number.MAX_SAFE_INTEGER)
                    - (b.tier ? duelWeaponTierOrder[b.tier] : Number.MAX_SAFE_INTEGER)
                || a.name.localeCompare(b.name, "en"),
        );
}

const pistolWeapons = weaponCategories.find((category) => category.id === "pistol")
    ?.weapons;

/** 绝密模式进入资格：A / S / S+ 级武器，且"单持手枪"不算（双持手枪算）。 */
export function isSecretEligibleWeapon(type: string): boolean {
    const tier = getDuelWeaponTier(type);
    if (tier !== "A" && tier !== "S" && tier !== "S+") return false;
    const base = dualWeaponBases[type] ?? type;
    const pistols = (pistolWeapons ?? []) as readonly string[];
    if (pistols.includes(base) && !type.endsWith("_dual")) return false;
    return true;
}

/** 绝密模式合格武器目录（带分类 / 图片 / 名称 / 等级），供进入规则展示。 */
export function getSecretEligibleCatalog() {
    return getDuelWeaponCatalog().filter((weapon) => isSecretEligibleWeapon(weapon.id));
}
