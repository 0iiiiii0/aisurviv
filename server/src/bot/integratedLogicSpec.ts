/**
 * Executable form of surviv-bot-full-integrated-logic(1).zip.
 *
 * The source package is a decision specification rather than source code. This
 * module centralizes the parts that must remain exact across the bot: weapon
 * tiers, ammo-request decoding, crate-threat arbitration, flare handling and
 * vault/control-panel recognition.
 */

export type IntegratedWeaponTier = "S+" | "S" | "A" | "B" | "C" | "D" | "F";

export const INTEGRATED_ARBITER_ORDER = [
    "mouseLen_clamp",
    "lethal_gas",
    "enemy_meleeing_me",
    "crate_threat_B",
    "ammo_share",
    "flare",
    "safe_heal",
    "unarmed_gun_hunt",
    "mode_branch",
    "engage_or_rotate",
] as const;

export const UNARMED_PRIORITY_MULTIPLIER = {
    groundGun: 3,
    lootContainer: 2.25,
    vaultPanel: 2,
    fight: 0.15,
} as const;

/**
 * Password-door (puzzle) sequences. The order is the exact button order the
 * server validates against `shared/defs/puzzles.ts`; pressing a wrong piece
 * resets the whole puzzle. Decoy pieces (for example the Eye bunker's swine /
 * caduceus / cloud / harpsichord switches) are simply not listed.
 */
export const PUZZLE_ORDERS: ReadonlyArray<{
    name: string;
    order: readonly string[];
}> = [
    {
        name: "bunker_eye_02",
        order: ["egg", "hydra", "storm", "conch", "crossing", "hatchet"],
    },
    {
        name: "bunker_chrys_01",
        order: ["ichi", "ni", "san", "shi"],
    },
    {
        name: "saloon",
        order: ["red", "orange", "yellow", "green", "blue", "indigo", "violet"],
    },
    {
        name: "club_01",
        order: ["1", "2", "3", "4"],
    },
    {
        name: "club_02",
        order: ["1"],
    },
];

/**
 * Infers which password sequence a building uses from the set of puzzle-piece
 * labels currently visible inside it. The longest fully-present order wins, so
 * a teahouse with pieces 1..4 is recognized as club_01 while a single "1" is
 * the bathhouse club_02.
 */
export function inferPuzzleOrder(
    pieceNames: Iterable<string>,
): readonly string[] | null {
    const present = new Set<string>();
    for (const name of pieceNames) {
        if (name) present.add(name);
    }
    let best: readonly string[] | null = null;
    for (const definition of PUZZLE_ORDERS) {
        const complete = definition.order.every((piece) => present.has(piece));
        if (!complete) continue;
        if (!best || definition.order.length > best.length) best = definition.order;
    }
    return best;
}

// A fixed 16-hit ceiling excluded many legitimate high-health resources.
// This remains a safety cap, while the bot's actual commitment is decided by
// value/time/threat scoring in smartBot instead of a low global allow-list.
export const INTEGRATED_MAX_RESOURCE_HITS = 48;

export const INTEGRATED_WEAPON_TIER_SCORE: Record<IntegratedWeaponTier, number> = {
    "S+": 100,
    S: 85,
    A: 70,
    B: 55,
    C: 40,
    D: 25,
    F: 5,
};

const normalizeWeaponName = (value: string): string =>
    value
        .toLowerCase()
        .replace(/[.()\-_]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

const TIER_NAMES: Record<IntegratedWeaponTier, readonly string[]> = {
    "S+": [
        "rainbow blaster",
        "awm s",
        "usas 12",
        "super 90",
        "m134",
        "potato cannon",
        "m79",
    ],
    S: [
        "sv 98",
        "mosin nagant",
        "m4a1 s",
        "mk 20 ssr",
        "m249",
        "saiga 12",
        "spas 12",
        "lasr gun",
        "heart cannon",
        "flamethrower",
        "spud gun",
    ],
    A: [
        "m1 garand",
        "l86a2",
        "svd 63",
        "mk45g",
        "scar h",
        "groza s",
        "groza",
        "an 94",
        "qbb 97",
        "pkp pecheneg",
        "pkm",
        "bar m1918",
        "vector 45 acp",
        "vector 9mm",
        "cz 3a1",
        "mp220",
        "hawk 12g",
        "p30l",
        "deagle 50",
    ],
    B: [
        "ak 47",
        "m416",
        "famas",
        "dp 28",
        "m39 emr",
        "mk 12 spr",
        "vss",
        "scout elite",
        "blr 81",
        "m870",
        "m1100",
        "mac 10",
        "m1a1",
        "ump9",
        "mp5",
        "peacemaker",
        "ots 38",
    ],
    C: ["g18c", "m93r", "ot 38", "m1911", "model 94"],
    D: ["m9", "m9 cursed", "water gun"],
    F: ["flare gun", "bugle"],
};

const TYPE_ALIASES: Record<string, string> = {
    awc: "awm s",
    usas: "usas 12",
    potato_cannon: "potato cannon",
    sv98: "sv 98",
    mosin: "mosin nagant",
    m4a1: "m4a1 s",
    saiga: "saiga 12",
    spas12: "spas 12",
    potato_smg: "spud gun",
    garand: "m1 garand",
    l86: "l86a2",
    svd: "svd 63",
    mkg45: "mk45g",
    scar: "scar h",
    grozas: "groza s",
    an94: "an 94",
    qbb97: "qbb 97",
    pkp: "pkp pecheneg",
    bar: "bar m1918",
    vector45: "vector 45 acp",
    vector: "vector 9mm",
    scorpion: "cz 3a1",
    deagle: "deagle 50",
    ak47: "ak 47",
    hk416: "m416",
    dp28: "dp 28",
    m39: "m39 emr",
    mk12: "mk 12 spr",
    blr: "blr 81",
    mac10: "mac 10",
    colt45: "peacemaker",
    ots38: "ots 38",
    glock: "g18c",
    ot38: "ot 38",
    model94: "model 94",
    m9_cursed: "m9 cursed",
    flare_gun: "flare gun",
};

const tierIndex = new Map<string, IntegratedWeaponTier>();
for (
    const [tier, names] of Object.entries(TIER_NAMES) as Array<
        [IntegratedWeaponTier, readonly string[]]
    >
) {
    for (const name of names) tierIndex.set(normalizeWeaponName(name), tier);
}

export function integratedWeaponTier(
    itemType: string,
    displayName = "",
): IntegratedWeaponTier | null {
    const alias = TYPE_ALIASES[itemType] ?? itemType;
    return (
        tierIndex.get(normalizeWeaponName(displayName))
            ?? tierIndex.get(normalizeWeaponName(alias))
            ?? null
    );
}

export function integratedWeaponTierScore(itemType: string, displayName = ""): number {
    const tier = integratedWeaponTier(itemType, displayName);
    return tier ? INTEGRATED_WEAPON_TIER_SCORE[tier] : 35;
}

export function isUtilityOnlyWeapon(itemType: string, displayName = ""): boolean {
    return integratedWeaponTier(itemType, displayName) === "F";
}

export const AMMO_REQUEST_EMOTE_TO_TYPE: Readonly<Record<string, string>> = {
    emote_ammo9mm: "9mm",
    emote_ammo12gauge: "12gauge",
    emote_ammo762mm: "762mm",
    emote_ammo556mm: "556mm",
    emote_ammo50ae: "50AE",
    emote_ammo308sub: "308sub",
    emote_ammoflare: "flare",
    emote_ammo45acp: "45acp",
};

const AMMO_REQUEST_TYPES = new Set(Object.values(AMMO_REQUEST_EMOTE_TO_TYPE));

/**
 * Resolves both the dedicated ammo emotes and the generic ammo-request wheel
 * entry. Some clients send `emote_ammo` and expect recipients to infer the
 * calibre from the requester's active weapon, so only matching the eight
 * dedicated emote names silently drops valid human requests.
 */
export function ammoTypeForRequestEmote(
    emoteType: string,
    itemType = "",
    activeWeaponAmmo = "",
): string | null {
    const dedicated = AMMO_REQUEST_EMOTE_TO_TYPE[emoteType];
    if (dedicated) return dedicated;
    if (emoteType !== "emote_ammo") return null;
    if (AMMO_REQUEST_TYPES.has(itemType)) return itemType;
    return AMMO_REQUEST_TYPES.has(activeWeaponAmmo) ? activeWeaponAmmo : null;
}

/** Uses the Team Ping wheel's Gift signal after a successful ammo drop. */
export function giftEmoteForAmmo(_ammoType: string): string {
    return "ping_help";
}

/** Mirrors Player.dropItem's ammo split so donors can preserve one magazine. */
export function predictedAmmoDropAmount(inventoryCount: number, minStackSize = 0): number {
    const count = Math.max(0, Math.floor(inventoryCount));
    if (count <= 0) return 0;
    let amount = Math.max(1, Math.floor(count / 2));
    if (minStackSize > 0 && count <= minStackSize) {
        amount = Math.min(minStackSize, count);
    } else if (count <= 5) {
        amount = Math.min(5, count);
    }
    return amount;
}

export function canDropRequestedAmmo(input: {
    inventoryCount: number;
    ownWeaponUsesAmmo: boolean;
    ownMagazineSize: number;
    minStackSize?: number;
    /** Human requests may use a smaller reserve floor than routine bot sharing. */
    reserveMagazineFraction?: number;
}): boolean {
    const reserveFraction = Math.max(
        0,
        Math.min(1, Number(input.reserveMagazineFraction ?? 1)),
    );
    const reserve = input.ownWeaponUsesAmmo
        ? Math.max(1, Math.ceil(input.ownMagazineSize * reserveFraction))
        : 0;
    const amount = predictedAmmoDropAmount(input.inventoryCount, input.minStackSize ?? 0);
    return amount > 0 && input.inventoryCount - amount >= reserve;
}

export type CrateThreatDecision = "combat" | "flee" | "continue-crate";

/** Exact table B from the integrated specification. */
export function decideCrateThreat(input: {
    enemyMeleeingMe: boolean;
    meHasGun: boolean;
    enemyHasGun: boolean;
}): CrateThreatDecision {
    if (input.enemyMeleeingMe) return "combat";
    if (input.meHasGun) return "combat";
    if (input.enemyHasGun) return "flee";
    return "continue-crate";
}

export function isVaultControlPanel(
    objectType: string,
    definition: Record<string, unknown> | undefined,
    runtimeButton?: { canUse?: boolean; onOff?: boolean },
): boolean {
    if (!definition || !runtimeButton?.canUse || runtimeButton.onOff) return false;
    const type = objectType.toLowerCase();
    const button = definition.button as Record<string, unknown> | undefined;
    if (!button) return false;
    const useType = String(button.useType ?? "").toLowerCase();
    return (
        /control_panel|power_box|switch/.test(type)
        && (/vault|cell_door|crossing_door|lab_door|secret_door/.test(useType)
            || /control_panel_0[124]|power_box/.test(type))
    );
}

export function shouldHandleGeneralFlare(input: {
    hasFlareGun: boolean;
    flareAmmo: number;
    enemyDistance: number;
    outsideGas: boolean;
    underAirstrike: boolean;
    indoors: boolean;
    currentPhase: "early" | "mid" | "late" | "final";
}): "fire" | "drop-empty" | "wait" {
    if (!input.hasFlareGun) return "wait";
    if (input.flareAmmo <= 0) return "drop-empty";
    if (
        input.enemyDistance <= 28
        || input.outsideGas
        || input.underAirstrike
        || input.indoors
        || input.currentPhase === "final"
    ) {
        return "wait";
    }
    return "fire";
}
