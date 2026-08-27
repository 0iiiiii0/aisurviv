import $ from "jquery";
import { perkCarryOutCap } from "../../shared/defs/extractionDefs.ts";
import { GearDefs } from "../../shared/defs/gameObjects/gearDefs.ts";
import { baseGunOf, dualGunOf, GunDefs } from "../../shared/defs/gameObjects/gunDefs.ts";
import { MeleeDefs } from "../../shared/defs/gameObjects/meleeDefs.ts";
import { PerkDefs } from "../../shared/defs/gameObjects/perkDefs.ts";
import { ThrowableDefs } from "../../shared/defs/gameObjects/throwableDefs.ts";
import { GameConfig } from "../../shared/gameConfig.ts";
import { getBagCapacity } from "../../shared/utils/bagCapacity.ts";

/**
 * 搜打撤仓库：独立界面。左栏展示当前带入配装（小人 + 护甲/武器 + 携带
 * 弹药/药品/投掷物），右栏展示仓库全部物资（带图片与数量）。
 * 玩家身份保存在浏览器 cookie 中。
 */

const IDENTITY_COOKIE = "surviv_stash_name";

interface StashData {
    guns: Record<string, number>;
    melee: Record<string, number>;
    ammo: Record<string, number>;
    consumables: Record<string, number>;
    helmets: Record<string, number>;
    chests: Record<string, number>;
    backpacks: Record<string, number>;
    scopes: Record<string, number>;
    throwables: Record<string, number>;
    perks: Record<string, number>;
}

interface BringInLoadout {
    guns: string[];
    melee?: string;
    ammo: Record<string, number>;
    consumables: Record<string, number>;
    throwables?: Record<string, number>;
    perks?: string[];
    /** 从独立一次性能力库存中手动选中，进局生效并消耗。 */
    oneTimePerks?: string[];
    armor: {
        helmet?: string;
        chest?: string;
        backpack?: string;
        scope?: string;
    };
}

export let currentName = "";

/** 切换当前配装身份（与 loadStash 设置的 currentName 一致）。 */
export function setCurrentName(name: string): void {
    currentName = name;
}

export let currentLoadout: BringInLoadout = {
    guns: [],
    ammo: {},
    consumables: {},
    throwables: {},
    perks: [],
    oneTimePerks: [],
    armor: {},
};
/** 购买后存入仓库、尚未选择携带的一次性能力类型。 */
export let oneTimePerkItems: string[] = [];

/** 同类型一次性能力允许重复购买；数组中的每一项都是一份独立库存。 */
const countOneTimePerks = (items: readonly string[]): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const type of items) counts[type] = (counts[type] ?? 0) + 1;
    return counts;
};

/** 合成只能消耗未被本局配装预留的永久技能。 */
const fusionAvailablePermanentPerks = (): Record<string, number> => {
    const counts = { ...stashItems.perks };
    for (const type of currentLoadout.perks ?? []) {
        counts[type] = Math.max(0, (counts[type] ?? 0) - 1);
    }
    return counts;
};
export let stashItems: StashData = {
    guns: {},
    melee: {},
    ammo: {},
    consumables: {},
    helmets: {},
    chests: {},
    backpacks: {},
    scopes: {},
    throwables: {},
    perks: {},
};

/** Invoked whenever the stash items or bring-in loadout change. */
export let onLoadoutChanged: (() => void) | null = null;

export function setOnLoadoutChanged(callback: (() => void) | null): void {
    onLoadoutChanged = callback;
}

// 武器槽内容：空串 = 空槽；单枪基名（如 "m9"）；双枪形态（如 "m9_dual"）。
// 每个槽位最多 2 把（双枪），两个槽位合计最多 4 把同型双持武器。
const slotBaseOf = (type: string): string | null => {
    if (!type) return null;
    if (type.endsWith("_dual")) return baseGunOf(type);
    return type;
};

const slotIsDual = (type: string): boolean =>
    Boolean(
        type && type.endsWith("_dual") && dualGunOf(slotBaseOf(type) ?? ""),
    );

/** 当前已装备某型武器的总把数（双枪槽按 2 把计）。 */
const equippedCopies = (type: string): number =>
    currentLoadout.guns.reduce((sum, t) => {
        if (!t) return sum;
        const base = slotBaseOf(t);
        if (base !== type) return sum;
        return sum + (slotIsDual(t) ? 2 : 1);
    }, 0);

/** 某类别物品当前在配装中的预留数量（装备/携带）。 */
const reservedAmount = (type: string, category: string): number => {
    switch (category) {
        case "guns":
            return equippedCopies(type);
        case "melee":
            return currentLoadout.melee === type ? 1 : 0;
        case "ammo":
            return Number(currentLoadout.ammo[type] ?? 0);
        case "consumables":
            return Number(currentLoadout.consumables[type] ?? 0);
        case "throwables":
            return Number(currentLoadout.throwables?.[type] ?? 0);
        case "helmets":
            return currentLoadout.armor.helmet === type ? 1 : 0;
        case "chests":
            return currentLoadout.armor.chest === type ? 1 : 0;
        case "backpacks":
            return currentLoadout.armor.backpack === type ? 1 : 0;
        case "scopes":
            return currentLoadout.armor.scope === type ? 1 : 0;
        case "perks":
            return (currentLoadout.perks ?? []).includes(type) ? 1 : 0;
        case "oneTimePerks":
            return (currentLoadout.oneTimePerks ?? []).includes(type) ? 1 : 0;
        default:
            return 0;
    }
};

const selectedPerks = (): string[] => [
    ...(currentLoadout.perks ?? []),
    ...(currentLoadout.oneTimePerks ?? []),
];

/** 归一化为 2 个固定武器槽位（空槽为空串）。 */
const normalizeGunSlots = (guns: string[]): string[] => {
    const out = Array.isArray(guns) ? [...guns] : [];
    while (out.length < 2) out.push("");
    return out;
};

/** 当前配装背包等级（0 = 无背包）。 */
const backpackLevel = (): number => {
    const type = currentLoadout.armor.backpack;
    if (!type) return 0;
    return Number(
        (GearDefs as Record<string, { level?: number }>)[type]?.level ?? 0,
    );
};

/** 携带上限：按背包等级（与服务端 grant 一致；无条目时回退 120）。 */
const carryCapacity = (type: string): number => getBagCapacity(type, backpackLevel(), true);

/** 把超背包容量的携带物放回仓库，返回提示文案。 */
const clampCarriedToBackpack = (): string[] => {
    const notes: string[] = [];
    const limit = (map: Record<string, number>): void => {
        for (const type of Object.keys(map)) {
            const cap = carryCapacity(type);
            const cur = Number(map[type] ?? 0);
            if (cur > cap) {
                const back = cur - cap;
                if (cap <= 0) delete map[type];
                else map[type] = cap;
                notes.push(`${itemName(type)} 放回 ${back}（上限 ${cap}）`);
            }
        }
    };
    limit(currentLoadout.ammo);
    limit(currentLoadout.consumables);
    if (currentLoadout.throwables) limit(currentLoadout.throwables);
    return notes;
};

/** 局内背包顺序：GameConfig.bagSizes 键序（弹药/投掷物/药品同表）。 */
const inGameOrderIndex = (type: string): number => {
    const order = Object.keys(GameConfig.bagSizes);
    const idx = order.indexOf(type);
    return idx >= 0 ? idx : order.length;
};

const byInGameOrder = (a: string, b: string): number => {
    const ia = inGameOrderIndex(a);
    const ib = inGameOrderIndex(b);
    return ia !== ib ? ia - ib : a.localeCompare(b);
};

// Serialize loadout saves so rapid clicks cannot overwrite each other, and
// discard stale stash loads when the player name is switched mid-request.
let saveQueue: Promise<void> = Promise.resolve();
let stashLoadSeq = 0;

// ---------- cookie identity ----------

export function getCookie(name: string): string {
    const match = document.cookie
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

export function setCookie(name: string, value: string, days = 365): void {
    const expires = new Date(Date.now() + days * 86400_000).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
}

// ---------- item metadata / images ----------

function spriteUrl(sprite: string): string {
    const base = sprite.replace(/\.img$/, "");
    return base.startsWith("gun-")
        ? `img/guns/${base}.svg`
        : `img/loot/${base}.svg`;
}

export function itemImage(type: string): string {
    // Ammo has dedicated icons under img/emotes (ammo-9mm.svg, ...).
    if (
        (GearDefs as Record<string, { type?: string }>)[type]?.type === "ammo"
    ) {
        return `img/emotes/ammo-${type}.svg`;
    }
    // Same weapon icon as the admin 1v1 loadout picker: the circular
    // loot drop image (img/loot/loot-weapon-<id>.svg).
    const gun = (
        GunDefs as Record<
            string,
            { lootImg?: { sprite?: string }; worldImg?: { sprite?: string } }
        >
    )[type];
    if (gun?.lootImg?.sprite) return spriteUrl(gun.lootImg.sprite);
    if (gun?.worldImg?.sprite) return spriteUrl(gun.worldImg.sprite);
    if (gun) return "img/guns/gun-long-01.svg";
    const gear = (
        GearDefs as Record<string, { lootImg?: { sprite?: string } }>
    )[type];
    if (gear?.lootImg?.sprite) return spriteUrl(gear.lootImg.sprite);
    const thr = (
        ThrowableDefs as Record<string, { lootImg?: { sprite?: string } }>
    )[type];
    if (thr?.lootImg?.sprite) return spriteUrl(thr.lootImg.sprite);
    const melee = (
        MeleeDefs as Record<string, { lootImg?: { sprite?: string } }>
    )[type];
    if (melee?.lootImg?.sprite) return spriteUrl(melee.lootImg.sprite);
    const perk = (
        PerkDefs as Record<string, { lootImg?: { sprite?: string } }>
    )[type];
    if (perk?.lootImg?.sprite) return spriteUrl(perk.lootImg.sprite);
    return "img/gui/dot.svg";
}

export function itemName(type: string): string {
    const gun = (GunDefs as Record<string, { name?: string }>)[type];
    if (gun?.name) return gun.name;
    const gear = (GearDefs as Record<string, { name?: string }>)[type];
    if (gear?.name) return gear.name;
    const thr = (ThrowableDefs as Record<string, { name?: string }>)[type];
    if (thr?.name) return thr.name;
    const melee = (MeleeDefs as Record<string, { name?: string }>)[type];
    if (melee?.name) return melee.name;
    const perk = (PerkDefs as Record<string, { name?: string }>)[type];
    if (perk?.name) return perk.name;
    return type;
}

export function esc(value: string): string {
    return value.replace(/[&<>"']/g, (char) => {
        switch (char) {
            case "&":
                return "&amp;";
            case "<":
                return "&lt;";
            case ">":
                return "&gt;";
            case "\"":
                return "&quot;";
            default:
                return "&#39;";
        }
    });
}

// ---------- api ----------

async function api<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
        ...init,
        // 仓库与商店是可变经济数据，禁止浏览器/反向代理复用旧快照。
        cache: init?.cache ?? "no-store",
    });
    if (!response.ok) {
        if (response.status === 401) {
            throw new Error("登录已过期，请重新登录");
        }
        throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as T;
}

/** 登录会话 token（与 playerAccount 共用 localStorage）。仓库/商店身份由服务端从 token 解析。 */
export function sessionToken(): string {
    return localStorage.getItem("surviv_player_session") || "";
}

/** 当前登录账号显示名（仓库身份，仅用于界面展示；与 playerAccount 共用 localStorage）。 */
export function sessionDisplayName(): string {
    return localStorage.getItem("surviv_player_display_name") || "";
}

export function setStatus(text: string, error = false): void {
    $("#extraction-stash-status")
        .text(text)
        .css("color", error ? "#ff6b6b" : "#7dffa8");
}

// ---------- rendering ----------

export function renderLeft(): void {
    const loadout = currentLoadout;

    // Equipment slots on the dummy.
    const slotImage = (
        slot: "helmet" | "chest" | "backpack" | "scope",
    ): string => {
        const type = loadout.armor[slot];
        return type ? itemImage(type) : "";
    };
    $(".stash-equip-helmet")
        .css(
            "background-image",
            slotImage("helmet") ? `url(${slotImage("helmet")})` : "",
        )
        .toggleClass("filled", !!loadout.armor.helmet)
        .attr("data-type", loadout.armor.helmet ?? "");
    $(".stash-equip-chest")
        .css(
            "background-image",
            slotImage("chest") ? `url(${slotImage("chest")})` : "",
        )
        .toggleClass("filled", !!loadout.armor.chest)
        .attr("data-type", loadout.armor.chest ?? "");
    $(".stash-equip-backpack")
        .css(
            "background-image",
            slotImage("backpack") ? `url(${slotImage("backpack")})` : "",
        )
        .toggleClass("filled", !!loadout.armor.backpack)
        .attr("data-type", loadout.armor.backpack ?? "");
    $(".stash-equip-scope")
        .css(
            "background-image",
            slotImage("scope") ? `url(${slotImage("scope")})` : "",
        )
        .toggleClass("filled", !!loadout.armor.scope)
        .attr("data-type", loadout.armor.scope ?? "");

    // Weapons.
    for (let i = 0; i < 3; i++) {
        const type = loadout.guns[i];
        const el = $(`#stash-weapon-${i}`).empty();
        const markSlot = (filled: boolean): void => {
            // 有武器的槽位可点击放回、可拖动交换（仅 1/2 号武器位）。
            el.toggleClass("filled", filled);
            el.attr("draggable", filled && i <= 1 ? "true" : "false");
        };
        if (i === 2) {
            const meleeType = loadout.melee;
            if (!meleeType) {
                el.html("<div class='stash-weapon-empty'>近战</div>");
                markSlot(false);
                continue;
            }
            el.html(
                `<img src='${itemImage(meleeType)}' alt='' draggable='false'/>`
                    + `<div class='stash-weapon-name'>${esc(itemName(meleeType))}</div>`,
            );
            markSlot(true);
            continue;
        }
        if (!type) {
            el.html("<div class='stash-weapon-empty'>武器槽</div>");
            markSlot(false);
            continue;
        }
        // 槽位内容可能是单枪或双枪形态（"m9" / "m9_dual"）。
        const dual = slotIsDual(type)
            ? (dualGunOf(slotBaseOf(type) ?? "") ?? type)
            : null;
        const shownType = dual ?? type;
        const nameType = slotBaseOf(type) ?? type;
        const def = (
            GunDefs as Record<string, { ammo?: string; name?: string }>
        )[nameType];
        const ammoType = def?.ammo ?? "";
        const carriedAmmo = ammoType ? Number(loadout.ammo[ammoType] ?? 0) : 0;
        el.html(
            `<img src='${itemImage(shownType)}' alt='' draggable='false'/>`
                + `<div class='stash-weapon-name'>${esc(def?.name ?? nameType)}${dual ? "（双枪）" : ""}</div>`
                + (ammoType
                    ? `<div class='stash-weapon-ammo' title='${esc(ammoType)}'>`
                        + `<img src='${itemImage(ammoType)}' alt='' draggable='false'/>`
                        + `<span>${esc(ammoType)} x${carriedAmmo}</span></div>`
                    : ""),
        );
        markSlot(true);
    }

    // Carried ammo / consumables / throwables (HUD-like counters).
    const renderStatList = (
        selector: string,
        entries: Array<[string, number]>,
        category = "",
    ): void => {
        const el = $(selector).empty();
        if (entries.length === 0) {
            el.html("<div class='stash-stat-empty'>—</div>");
            return;
        }
        for (const [type, count] of entries) {
            if (count <= 0) continue;
            const $item = $(
                `<div class='stash-stat' title='${esc(itemName(type))}'>`
                    + `<img src='${itemImage(type)}' alt='' draggable='false'/>`
                    + `<span>${esc(type)} x${count}</span></div>`,
            );
            if (category) {
                $item.on("contextmenu", (e) => {
                    e.preventDefault();
                    void unequip(type, category);
                });
                $item.on("click", () => {
                    void toggleEquip(type, category);
                });
            }
            el.append($item);
        }
    };
    renderStatList(
        "#stash-ammo-list",
        Object.entries(loadout.ammo).sort(([a], [b]) => byInGameOrder(a, b)),
        "ammo",
    );
    renderStatList(
        "#stash-heal-list",
        Object.entries(loadout.consumables).sort(([a], [b]) => byInGameOrder(a, b)),
        "consumables",
    );
    renderStatList(
        "#stash-throw-list",
        Object.entries(loadout.throwables ?? {}).sort(([a], [b]) => byInGameOrder(a, b)),
        "throwables",
    );
    renderStatList(
        "#stash-perk-list",
        (loadout.perks ?? []).map((type) => [type, 1] as [string, number]),
        "perks",
    );
    renderStatList(
        "#stash-one-time-perk-list",
        (loadout.oneTimePerks ?? []).map(
            (type) => [type, 1] as [string, number],
        ),
        "oneTimePerks",
    );
    renderPerkCarryOutSlots(
        selectedPerks(),
        new Set(loadout.oneTimePerks ?? []),
    );

    // 装备摘要（头盔/护甲/背包/倍镜），独立页展示。
    const equipEl = $("#stash-equip-list");
    if (equipEl.length) {
        equipEl.empty();
        const slots: Array<[keyof BringInLoadout["armor"], string]> = [
            ["helmet", "头盔"],
            ["chest", "护甲"],
            ["backpack", "背包"],
            ["scope", "倍镜"],
        ];
        for (const [slot, label] of slots) {
            const type = loadout.armor[slot];
            if (!type) continue;
            equipEl.append(
                `<div class='stash-stat' title='${label}'>`
                    + `<img src='${itemImage(type)}' alt='' draggable='false'/>`
                    + `<span>${esc(itemName(type))}</span></div>`,
            );
        }
    }
}

/**
 * 能力带出槽位小 UI：展示“带入 N 个 → 可带出 M 个”（空槽位占位）。
 * 槽位在进局时锁定，局内丢弃旧能力不会增减；仅搜打撤/绝密两种模式显示。
 */
function renderPerkCarryOutSlots(
    broughtIn: string[],
    oneTimePerks = new Set<string>(),
): void {
    const el = $("#stash-perk-slot-list");
    if (!el.length) return;
    el.empty();
    const n = broughtIn.length;
    const cap = perkCarryOutCap(n);
    const cells: string[] = [];
    for (let i = 0; i < cap; i++) {
        const type = i < n ? broughtIn[i] : "";
        if (type) {
            const oneTime = oneTimePerks.has(type);
            cells.push(
                `<div class='stash-perk-slot filled${oneTime ? " one-time" : ""}' title='${esc(itemName(type))}${
                    oneTime ? "（一次性）" : ""
                }'>`
                    + `<img src='${itemImage(type)}' alt='' draggable='false'/>`
                    + `</div>`,
            );
        } else {
            cells.push(
                `<div class='stash-perk-slot empty' title='空槽位（可带出局内获得的能力）'>+</div>`,
            );
        }
    }
    el.html(
        cells.join("")
            + `<div class='stash-perk-slot-info'>带入 ${n} 个 → 可带出 ${cap} 个</div>`,
    );
}

export function renderRight(): void {
    const renderGrid = (
        selector: string,
        items: Record<string, number>,
        category: string,
        equipped: (type: string) => boolean,
        itemClass = "",
    ): void => {
        const el = $(selector).empty();
        const entries = Object.entries(items).sort(([a], [b]) => {
            // 倍镜按倍率从小到大（1x / 2x / 4x / 8x / 15x），其余按名称。
            if (category === "scopes") {
                const na = Number.parseInt(a.match(/^(\d+)x/)?.[1] ?? "0", 10);
                const nb = Number.parseInt(b.match(/^(\d+)x/)?.[1] ?? "0", 10);
                return na - nb;
            }
            // 弹药/药品/投掷物按局内背包顺序（GameConfig.bagSizes 键序）。
            if (
                category === "ammo"
                || category === "consumables"
                || category === "throwables"
            ) {
                return byInGameOrder(a, b);
            }
            return a.localeCompare(b);
        });
        if (entries.length === 0) {
            el.html("<div class='stash-empty'>空</div>");
            return;
        }
        for (const [type, count] of entries) {
            const isEquipped = equipped(type);
            // 装备/携带后视为从仓库预留：显示"仓库剩余 = 总量 - 已装备/携带"。
            const equippedAmount = reservedAmount(type, category);
            const availableCount = Math.max(0, count - equippedAmount);
            const isSmall = category === "ammo"
                || category === "consumables"
                || category === "throwables";
            const carried = category === "ammo"
                ? Number(currentLoadout.ammo[type] ?? 0)
                : category === "consumables"
                ? Number(currentLoadout.consumables[type] ?? 0)
                : Number(currentLoadout.throwables?.[type] ?? 0);
            const inputHtml = isSmall
                ? `<div class='stash-stepper'>`
                    + `<button type='button' class='stash-stepper-btn' data-step='-1' title='减少一组'>−</button>`
                    + `<input type='number' class='stash-item-input' value='${carried}' min='0' max='${count}' title='直接输入携带数量' />`
                    + `<button type='button' class='stash-stepper-btn' data-step='1' title='增加一组'>+</button>`
                    + `</div>`
                : "";
            el.append(
                `<div class='stash-item ${isEquipped ? "equipped" : ""} ${
                    isSmall ? "small" : ""
                } ${itemClass}' data-type='${esc(type)}' data-category='${category}' title='${esc(itemName(type))}'>`
                    + `<img src='${itemImage(type)}' alt='' draggable='false'/>`
                    + `<div class='stash-item-name'>${esc(itemName(type))}</div>`
                    + `<div class='stash-item-count'>x${availableCount}</div>`
                    + inputHtml
                    + `</div>`,
            );
        }
    };

    renderGrid(
        "#stash-items-guns",
        stashItems.guns,
        "guns",
        (type) => currentLoadout.guns.some((t) => slotBaseOf(t) === type),
    );
    renderGrid(
        "#stash-items-melee",
        stashItems.melee,
        "melee",
        (type) => currentLoadout.melee === type,
    );
    const armorEquipped = (type: string): boolean => Object.values(currentLoadout.armor).includes(type);
    // 护甲类别只含头盔/胸甲/背包；倍镜单列（旧数据兼容过滤）。
    renderGrid(
        "#stash-items-helmets",
        stashItems.helmets,
        "helmets",
        armorEquipped,
    );
    renderGrid(
        "#stash-items-chests",
        stashItems.chests,
        "chests",
        armorEquipped,
    );
    renderGrid(
        "#stash-items-backpacks",
        stashItems.backpacks,
        "backpacks",
        armorEquipped,
    );
    renderGrid(
        "#stash-items-scopes",
        stashItems.scopes,
        "scopes",
        (type) => currentLoadout.armor.scope === type,
    );
    renderGrid(
        "#stash-items-ammo",
        stashItems.ammo,
        "ammo",
        (type) => (currentLoadout.ammo[type] ?? 0) > 0,
    );
    renderGrid(
        "#stash-items-consumables",
        stashItems.consumables,
        "consumables",
        (type) => (currentLoadout.consumables[type] ?? 0) > 0,
    );
    renderGrid(
        "#stash-items-throwables",
        stashItems.throwables,
        "throwables",
        (type) => (currentLoadout.throwables?.[type] ?? 0) > 0,
    );
    renderGrid("#stash-items-perks", stashItems.perks, "perks", (type) => (currentLoadout.perks ?? []).includes(type));
    renderGrid(
        "#stash-items-one-time-perks",
        countOneTimePerks(oneTimePerkItems),
        "oneTimePerks",
        (type) => (currentLoadout.oneTimePerks ?? []).includes(type),
        "one-time-perk",
    );
    renderPerkFusionControls();
}

function selectedFusionMaterials(): [string, string] {
    return [
        String($("#perk-fusion-material-a").val() ?? ""),
        String($("#perk-fusion-material-b").val() ?? ""),
    ];
}

function updatePerkFusionButton(): void {
    const button = $("#perk-fusion-submit");
    if (!button.length) return;
    const [first, second] = selectedFusionMaterials();
    const available = fusionAvailablePermanentPerks();
    const required: Record<string, number> = {};
    if (first) required[first] = (required[first] ?? 0) + 1;
    if (second) required[second] = (required[second] ?? 0) + 1;
    const valid = Boolean(first && second) && Object.entries(required).every(
        ([type, count]) => (available[type] ?? 0) >= count,
    );
    button.prop("disabled", !valid);
}

/** 根据仓库现存数量刷新两个合成材料下拉框。 */
function renderPerkFusionControls(): void {
    const firstSelect = $("#perk-fusion-material-a");
    const secondSelect = $("#perk-fusion-material-b");
    if (!firstSelect.length || !secondSelect.length) return;
    const previous = selectedFusionMaterials();
    const counts = fusionAvailablePermanentPerks();
    const types = Object.keys(counts)
        .filter((type) => counts[type] > 0)
        .sort((a, b) => itemName(a).localeCompare(itemName(b)));
    const html = types.length > 0
        ? types.map((type) => `<option value='${esc(type)}'>${esc(itemName(type))} ×${counts[type]}</option>`).join("")
        : "<option value=''>没有可用材料</option>";
    firstSelect.html(html);
    secondSelect.html(html);

    const first = types.includes(previous[0]) ? previous[0] : (types[0] ?? "");
    let second = types.includes(previous[1]) ? previous[1] : "";
    if (!second) {
        second = (counts[first] ?? 0) >= 2
            ? first
            : (types.find((type) => type !== first) ?? "");
    }
    firstSelect.val(first);
    secondSelect.val(second);
    updatePerkFusionButton();
}

function fusionFailureText(reason: string | undefined): string {
    switch (reason) {
        case "not-enough":
            return "材料数量不足，请刷新仓库后重试";
        case "equipped":
            return "选中的技能正在本局配装中，请先放回仓库";
        case "invalid-materials":
            return "合成材料无效";
        case "empty-pool":
            return "当前没有可随机生成的技能";
        case "stack-full":
            return "合成产物库存已满";
        case "permanent-perks-only":
            return "页面版本过旧，请刷新后使用永久技能合成";
        default:
            return reason || "未知原因";
    }
}

async function fuseSelectedPermanentPerks(): Promise<void> {
    const token = sessionToken();
    if (!token) {
        setStatus("请先登录后再合成技能", true);
        return;
    }
    const materials = selectedFusionMaterials();
    updatePerkFusionButton();
    if ($("#perk-fusion-submit").prop("disabled")) {
        setStatus("需要两份未装备的永久技能才能合成", true);
        return;
    }
    $("#perk-fusion-submit").prop("disabled", true).text("合成中…");
    try {
        // A rapid equip/unequip click may still have a serialized loadout save
        // in flight. Finish it first so the fusion transaction reserves exactly
        // what the current UI shows as equipped.
        await saveQueue;
        const result = await api<{
            ok?: boolean;
            reason?: string;
            perks?: Record<string, number>;
            resultType?: string;
            resultName?: string;
        }>("/api/shop/perk/fuse", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, materials }),
        });
        if (!result.ok || !result.resultType) {
            setStatus(`合成失败：${fusionFailureText(result.reason)}`, true);
            return;
        }
        if (result.perks && typeof result.perks === "object") {
            stashItems.perks = { ...result.perks };
        } else {
            await loadStash();
        }
        renderRight();
        const label = result.resultName || itemName(result.resultType);
        $("#perk-fusion-result").text(`合成成功：获得 ${label}`);
        setStatus(`技能合成成功：获得 ${label}`);
        onLoadoutChanged?.();
    } catch (error) {
        setStatus(
            `合成失败：${error instanceof Error ? error.message : String(error)}`,
            true,
        );
    } finally {
        $("#perk-fusion-submit").text("随机合成");
        updatePerkFusionButton();
    }
}

// ---------- loadout mutations ----------

/**
 * 配装阶段校验提示：
 * - 已带枪械未携带对应弹药 / 弹药不足（少于 3 个弹匣）→ 提示；
 * - 已带枪械未带任何医疗物品 → 提示；
 * - 仓库中没有该类型物品（对应弹药 / 任何医疗物品）则不提示。
 */
export function loadoutWarnings(): string[] {
    const warnings: string[] = [];
    const loadout = currentLoadout;
    const warned = new Set<string>();
    for (const slotType of loadout.guns) {
        if (!slotType) continue;
        const gunType = slotBaseOf(slotType) ?? slotType;
        if (warned.has(gunType)) continue;
        warned.add(gunType);
        const def = (
            GunDefs as Record<
                string,
                {
                    name?: string;
                    ammo?: string;
                    maxClip?: number;
                    ammoInfinite?: boolean;
                }
            >
        )[gunType];
        if (!def?.ammo) continue;
        if (def.ammoInfinite) continue; // 无限弹药武器（如土豆炮）无需携带弹药
        const ammoType = def.ammo;
        const stashHas = Number(stashItems.ammo[ammoType] ?? 0) > 0;
        if (!stashHas) continue; // 仓库无该弹药 → 不提示
        const carried = Number(loadout.ammo[ammoType] ?? 0);
        const gunCount = equippedCopies(gunType);
        const need = Math.max(
            1,
            Math.floor((def.maxClip ?? 30) * 3 * gunCount),
        );
        if (carried <= 0) {
            warnings.push(`${def.name ?? gunType} 未携带 ${ammoType} 弹药`);
        } else if (carried < need) {
            warnings.push(
                `${def.name ?? gunType} 弹药不足（建议 ≥${need} 发，当前 ${carried}）`,
            );
        }
    }
    const stashHasMedical = Object.keys(stashItems.consumables).some((type) => {
        const def = (GearDefs as Record<string, { type?: string }>)[type];
        return def?.type === "heal" || def?.type === "boost";
    });
    if (
        loadout.guns.some((t) => t)
        && stashHasMedical
        && Object.keys(loadout.consumables).length === 0
    ) {
        warnings.push("未携带医疗物品");
    }
    return warnings;
}

export function persistLoadout(): Promise<void> {
    saveQueue = saveQueue.then(runPersistLoadout, runPersistLoadout);
    return saveQueue;
}

async function runPersistLoadout(): Promise<void> {
    const token = sessionToken();
    if (!token) {
        setStatus("请先登录后使用仓库", true);
        renderLeft();
        renderRight();
        onLoadoutChanged?.();
        return;
    }
    try {
        const result = await api<{ ok?: boolean; loadout?: BringInLoadout }>(
            "/api/extraction/loadout",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, loadout: currentLoadout }),
            },
        );
        if (result?.loadout) {
            currentLoadout = {
                guns: normalizeGunSlots(result.loadout.guns ?? []),
                melee: result.loadout.melee,
                ammo: result.loadout.ammo ?? {},
                consumables: result.loadout.consumables ?? {},
                throwables: result.loadout.throwables ?? {},
                perks: [...(result.loadout.perks ?? [])],
                oneTimePerks: [...(result.loadout.oneTimePerks ?? [])],
                armor: result.loadout.armor ?? {},
            };
        }
        const warnings = loadoutWarnings();
        if (warnings.length > 0) {
            setStatus(`配装已保存，注意：${warnings.join("；")}`, true);
        } else {
            setStatus("配装已保存（进局时自动扣除）");
        }
    } catch (error) {
        setStatus(
            `保存失败：${error instanceof Error ? error.message : String(error)}`,
            true,
        );
    }
    renderLeft();
    renderRight();
    onLoadoutChanged?.();
}

/** 一键放回：清空当前配装，所有携带物品放回仓库。 */
export async function resetLoadout(): Promise<void> {
    currentLoadout = {
        guns: ["", ""],
        melee: undefined,
        ammo: {},
        consumables: {},
        throwables: {},
        perks: [],
        oneTimePerks: [],
        armor: {},
    };
    await persistLoadout();
    setStatus("已把所有携带物品放回仓库");
}

export async function toggleEquip(
    type: string,
    category: string,
): Promise<void> {
    let backpackClampNotes: string[] = [];
    if (category === "guns") {
        // 保证两个固定槽位（空槽为空串），兼容旧版未补齐的数组。
        while (currentLoadout.guns.length < 2) currentLoadout.guns.push("");
        // 左键 = 增加一把（不会放回第一把）。双持武器最多 4 把：
        // 1 把→1号位单持，2 把→1号位双持，3 把→1号位双持+2号位单持，
        // 4 把→1、2 号位都是双持。非双持武器最多 2 把（两个单持槽）。
        const maxCopies = dualGunOf(type) ? 4 : 2;
        if (equippedCopies(type) >= maxCopies) {
            setStatus(
                dualGunOf(type)
                    ? "该武器最多装备 4 把（1、2 号位双持）"
                    : "该武器最多装备 2 把（1、2 号位各一把）",
                true,
            );
            return;
        }
        // 仓库剩余数量（总量 - 已装备）不足时不能再加。
        if (equippedCopies(type) >= Number(stashItems.guns[type] ?? 0)) {
            setStatus("仓库中该武器数量不足", true);
            return;
        }
        // 1) 已有该枪的槽位：单枪槽升级为双枪槽（双持形态，不清其它槽）。
        if (dualGunOf(type)) {
            for (let i = 0; i < 2; i++) {
                const t = currentLoadout.guns[i];
                if (t && !slotIsDual(t) && t === type) {
                    currentLoadout.guns[i] = dualGunOf(type)!;
                    await persistLoadout();
                    return;
                }
            }
        }
        // 2) 放入第一个空槽。
        const empty = currentLoadout.guns.indexOf("");
        if (empty >= 0) {
            currentLoadout.guns[empty] = type;
        } else {
            setStatus("武器槽已满，请先放回一把武器", true);
            return;
        }
    } else if (category === "melee") {
        if (currentLoadout.melee === type) {
            delete currentLoadout.melee;
        } else {
            if (Number(stashItems.melee[type] ?? 0) < 1) {
                setStatus("仓库中没有该近战武器", true);
                return;
            }
            currentLoadout.melee = type;
        }
    } else if (
        category === "helmets"
        || category === "chests"
        || category === "backpacks"
        || category === "scopes"
    ) {
        const slot = armorSlotFor(type);
        if (!slot) return;
        if (currentLoadout.armor[slot] === type) {
            delete currentLoadout.armor[slot];
        } else {
            currentLoadout.armor[slot] = type;
        }
        // 更换/移除背包后，超限的携带物放回仓库并提示。
        if (slot === "backpack") {
            backpackClampNotes = clampCarriedToBackpack();
        }
    } else if (category === "perks") {
        const carried = currentLoadout.perks ?? [];
        if (carried.includes(type)) {
            currentLoadout.perks = carried.filter((t) => t !== type);
        } else {
            if (Number(stashItems.perks[type] ?? 0) < 1) {
                setStatus("仓库中没有该能力", true);
                return;
            }
            if ((currentLoadout.oneTimePerks ?? []).includes(type)) {
                setStatus("同类型能力不能同时携带永久与一次性版本", true);
                return;
            }
            if (selectedPerks().length >= 4) {
                setStatus("普通与一次性能力合计最多携带 4 个", true);
                return;
            }
            currentLoadout.perks = [...carried, type];
        }
    } else if (category === "oneTimePerks") {
        const carried = currentLoadout.oneTimePerks ?? [];
        if (carried.includes(type)) {
            currentLoadout.oneTimePerks = carried.filter((t) => t !== type);
        } else {
            if (!oneTimePerkItems.includes(type)) {
                setStatus("仓库中没有该一次性能力", true);
                return;
            }
            if ((currentLoadout.perks ?? []).includes(type)) {
                setStatus("同类型能力不能同时携带永久与一次性版本", true);
                return;
            }
            if (selectedPerks().length >= 4) {
                setStatus("普通与一次性能力合计最多携带 4 个", true);
                return;
            }
            currentLoadout.oneTimePerks = [...carried, type];
        }
    }
    await persistLoadout();
    if (backpackClampNotes.length > 0) {
        setStatus(
            `背包容量不足，已放回仓库：${backpackClampNotes.join("；")}`,
            true,
        );
    }
}

/** 卸下装备（不删除仓库物品；未装备时无操作）。 */
export async function unequip(type: string, category: string): Promise<void> {
    let backpackClampNotes: string[] = [];
    if (category === "guns") {
        // 右键 = 卸下一把：从 2 号位往前找，双枪槽先降为单枪，再清空。
        for (let i = 1; i >= 0; i--) {
            const t = currentLoadout.guns[i];
            if (!t) continue;
            if (slotIsDual(t) && slotBaseOf(t) === type) {
                currentLoadout.guns[i] = slotBaseOf(t)!;
                await persistLoadout();
                return;
            }
            if (t === type) {
                currentLoadout.guns[i] = "";
                await persistLoadout();
                return;
            }
        }
        return;
    } else if (category === "melee") {
        if (currentLoadout.melee === type) delete currentLoadout.melee;
    } else if (
        category === "helmets"
        || category === "chests"
        || category === "backpacks"
        || category === "scopes"
    ) {
        const slot = armorSlotFor(type);
        if (slot && currentLoadout.armor[slot] === type) {
            delete currentLoadout.armor[slot];
            if (slot === "backpack") {
                backpackClampNotes = clampCarriedToBackpack();
            }
        }
    } else if (category === "perks") {
        const carried = currentLoadout.perks ?? [];
        if (carried.includes(type)) {
            currentLoadout.perks = carried.filter((t) => t !== type);
        }
    } else if (category === "oneTimePerks") {
        const carried = currentLoadout.oneTimePerks ?? [];
        if (carried.includes(type)) {
            currentLoadout.oneTimePerks = carried.filter((t) => t !== type);
        }
    } else {
        return;
    }
    await persistLoadout();
    if (backpackClampNotes.length > 0) {
        setStatus(
            `背包容量不足，已放回仓库：${backpackClampNotes.join("；")}`,
            true,
        );
    }
}

function armorSlotFor(
    type: string,
): "helmet" | "chest" | "backpack" | "scope" | null {
    const def = (GearDefs as Record<string, { type?: string }>)[type];
    switch (def?.type) {
        case "helmet":
            return "helmet";
        case "chest":
            return "chest";
        case "backpack":
            return "backpack";
        case "scope":
            return "scope";
        default:
            return null;
    }
}

/**
 * 单次携带/减少步长：弹药默认 30 发（信号弹 1 发、.308 AWM 弹药 5 发），
 * 绷带一次 5 个，其余物资 1 个。左键与右键使用相同步长。
 */
function carryStep(type: string, category: string): number {
    if (category === "ammo") {
        if (type === "flare") return 1;
        if (type === "308sub") return 5;
        return 30;
    }
    if (category === "consumables" && type === "bandage") return 5;
    return 1;
}

export async function adjustCarry(
    type: string,
    category: string,
    delta: number,
): Promise<void> {
    const map = category === "ammo"
        ? currentLoadout.ammo
        : category === "consumables"
        ? currentLoadout.consumables
        : (currentLoadout.throwables ??= {});
    const current = Number(map[type] ?? 0);
    if (delta > 0) {
        // 一次携带一组；仓库剩余不足时全部带上。
        const step = carryStep(type, category);
        const remaining = Math.max(
            0,
            Number(stashItems[category as keyof StashData]?.[type] ?? 0)
                - current,
        );
        // 不超过当前背包容量上限。
        const room = carryCapacity(type) - current;
        const take = Math.min(step, remaining, room);
        if (take <= 0) return;
        map[type] = current + take;
        await persistLoadout();
        return;
    }
    // 右键按相同步长减少。
    const next = Math.max(0, current - carryStep(type, category));
    if (next <= 0) delete map[type];
    else map[type] = next;
    await persistLoadout();
}

/** 直接设置携带数量（0 ~ 仓库总量）。 */
export async function setCarry(
    type: string,
    category: string,
    rawCount: number,
): Promise<void> {
    const map = category === "ammo"
        ? currentLoadout.ammo
        : category === "consumables"
        ? currentLoadout.consumables
        : (currentLoadout.throwables ??= {});
    const stashCount = Number(
        stashItems[category as keyof StashData]?.[type] ?? 0,
    );
    // 不超过当前背包容量上限。
    const target = Math.max(
        0,
        Math.min(Math.floor(rawCount) || 0, stashCount, carryCapacity(type)),
    );
    if (target <= 0) delete map[type];
    else map[type] = target;
    await persistLoadout();
}

export async function loadStash(): Promise<void> {
    const token = sessionToken();
    if (!token) {
        setStatus("请先登录后使用仓库", true);
        return;
    }
    const seq = ++stashLoadSeq;
    try {
        const data = await api<{
            name: string;
            items: StashData;
            loadout: BringInLoadout;
            oneTimePerks?: string[];
        }>(`/api/extraction/stash?token=${encodeURIComponent(token)}`);
        if (seq !== stashLoadSeq) return; // 已切换会话，丢弃过期响应
        // 仓库身份由服务端根据登录 token 解析，客户端仅用于界面展示。
        if (data.name) {
            currentName = data.name;
            setCookie(IDENTITY_COOKIE, data.name);
            $("#extraction-stash-name").val(data.name).prop("readonly", true);
        }
        stashItems = {
            guns: data.items?.guns ?? {},
            melee: data.items?.melee ?? {},
            ammo: data.items?.ammo ?? {},
            consumables: data.items?.consumables ?? {},
            helmets: data.items?.helmets ?? {},
            chests: data.items?.chests ?? {},
            backpacks: data.items?.backpacks ?? {},
            scopes: data.items?.scopes ?? {},
            throwables: data.items?.throwables ?? {},
            perks: data.items?.perks ?? {},
        };
        oneTimePerkItems = (data.oneTimePerks ?? []).filter(
            (type): type is string => typeof type === "string" && type.length > 0,
        );
        currentLoadout = {
            guns: normalizeGunSlots(data.loadout?.guns ?? []),
            melee: data.loadout?.melee,
            ammo: data.loadout?.ammo ?? {},
            consumables: data.loadout?.consumables ?? {},
            throwables: data.loadout?.throwables ?? {},
            perks: [...(data.loadout?.perks ?? [])],
            oneTimePerks: [...(data.loadout?.oneTimePerks ?? [])],
            armor: data.loadout?.armor ?? {},
        };
        // 旧版数据可能超背包容量：自动放回并保存，避免进局被截断。
        const clampNotes = clampCarriedToBackpack();
        renderLeft();
        renderRight();
        if (clampNotes.length > 0) {
            await persistLoadout();
            setStatus(
                `背包容量不足，已放回仓库：${clampNotes.join("；")}`,
                true,
            );
        } else {
            setStatus("仓库已加载");
        }
        onLoadoutChanged?.();
    } catch (error) {
        if (seq !== stashLoadSeq) return;
        setStatus(
            `加载失败：${error instanceof Error ? error.message : String(error)}`,
            true,
        );
    }
}

export function openExtractionStashPanel(): void {
    // 仓库身份由登录 token 决定；未登录时不能查看/编辑仓库。
    const token = sessionToken();
    const account = (
        window as unknown as {
            survivPlayerAccount?: { loggedIn: boolean; displayName: string };
        }
    ).survivPlayerAccount;
    const accountName = account?.loggedIn
        ? account.displayName
        : sessionDisplayName();
    if (token && accountName) {
        setCookie(IDENTITY_COOKIE, accountName);
        currentName = accountName;
        $("#extraction-stash-name").val(accountName).prop("readonly", true);
        $("#extraction-stash-panel").show();
        void loadStash();
    } else {
        $("#extraction-stash-name").prop("readonly", false);
        $("#extraction-stash-panel").hide();
        setStatus("请先登录后使用仓库", true);
    }
}

export function bindStashEvents(): void {
    // 一键放回：清空配装并把携带物放回仓库。
    $("#btn-stash-clear").on("click", () => void resetLoadout());
    $("#perk-fusion-material-a, #perk-fusion-material-b").on(
        "change",
        updatePerkFusionButton,
    );
    $("#perk-fusion-submit").on("click", () => void fuseSelectedPermanentPerks());
    // 武器槽：点击放回仓库；拖动 1、2 号武器位交换。
    const slotIndex = (el: HTMLElement): number =>
        Number(
            String($(el).attr("id") ?? "")
                .split("-")
                .pop() ?? -1,
        );
    let weaponDragFrom = -1;
    $(".stash-weapon").on("dragstart", (event) => {
        const slot = slotIndex(event.currentTarget as HTMLElement);
        const type = slot === 2 ? currentLoadout.melee : currentLoadout.guns[slot];
        if (!type || slot > 1) {
            event.preventDefault();
            return;
        }
        weaponDragFrom = slot;
        const dt = event.originalEvent?.dataTransfer;
        if (dt) {
            dt.effectAllowed = "move";
            dt.setData("text/plain", String(slot));
        }
        $(".stash-weapon").removeClass("drag-over");
    });
    $(".stash-weapon").on("dragover", (event) => {
        event.preventDefault();
        const slot = slotIndex(event.currentTarget as HTMLElement);
        $(event.currentTarget).toggleClass(
            "drag-over",
            slot <= 1 && weaponDragFrom >= 0 && slot !== weaponDragFrom,
        );
    });
    $(".stash-weapon").on("dragleave", (event) => {
        $(event.currentTarget).removeClass("drag-over");
    });
    $(".stash-weapon").on("drop", (event) => {
        event.preventDefault();
        $(".stash-weapon").removeClass("drag-over");
        const from = weaponDragFrom;
        weaponDragFrom = -1;
        const to = slotIndex(event.currentTarget as HTMLElement);
        if (from < 0 || from > 1 || to < 0 || to > 1 || from === to) return;
        const tmp = currentLoadout.guns[from];
        currentLoadout.guns[from] = currentLoadout.guns[to];
        currentLoadout.guns[to] = tmp;
        void persistLoadout();
    });
    $(".stash-weapon").on("dragend", () => {
        weaponDragFrom = -1;
        $(".stash-weapon").removeClass("drag-over");
    });
    $("#stash-weapon-0, #stash-weapon-1").on("click", (event) => {
        const slot = slotIndex(event.currentTarget as HTMLElement);
        const type = currentLoadout.guns[slot];
        if (!type) return;
        // 放回仓库：整槽放回（单枪 1 把 / 双枪 2 把），另一槽位位置不变。
        currentLoadout.guns[slot] = "";
        void persistLoadout();
    });
    $("#stash-weapon-2").on("click", () => {
        if (!currentLoadout.melee) return;
        delete currentLoadout.melee;
        void persistLoadout();
    });
    // Item card interactions (delegated).
    $(".stash-right").on("click", ".stash-item", (event) => {
        const target = $(event.currentTarget);
        if ($(event.target).is("input")) return;
        if ($(event.target).hasClass("stash-stepper-btn")) return;
        const type = String(target.data("type") ?? "");
        const category = String(target.data("category") ?? "");
        if (
            category === "guns"
            || category === "helmets"
            || category === "chests"
            || category === "backpacks"
            || category === "scopes"
            || category === "melee"
            || category === "perks"
            || category === "oneTimePerks"
        ) {
            void toggleEquip(type, category);
        } else {
            void adjustCarry(type, category, 1);
        }
    });
    $(".stash-right").on("contextmenu", ".stash-item", (event) => {
        event.preventDefault();
        if ($(event.target).is("input")) return;
        if ($(event.target).hasClass("stash-stepper-btn")) return;
        const target = $(event.currentTarget);
        const type = String(target.data("type") ?? "");
        const category = String(target.data("category") ?? "");
        if (
            category === "guns"
            || category === "helmets"
            || category === "chests"
            || category === "backpacks"
            || category === "scopes"
            || category === "melee"
            || category === "perks"
            || category === "oneTimePerks"
        ) {
            // 右键 = 卸下装备，不删除仓库物品。
            void unequip(type, category);
        } else {
            void adjustCarry(type, category, -1);
        }
    });
    $(".stash-right").on("change", ".stash-item-input", (event) => {
        const input = $(event.currentTarget);
        const type = String(input.closest(".stash-item").data("type") ?? "");
        const category = String(
            input.closest(".stash-item").data("category") ?? "",
        );
        void setCarry(type, category, Number(input.val()));
    });
    $(".stash-right").on("keydown", ".stash-item-input", (event) => {
        if (event.key === "Enter") {
            const input = $(event.currentTarget);
            const type = String(
                input.closest(".stash-item").data("type") ?? "",
            );
            const category = String(
                input.closest(".stash-item").data("category") ?? "",
            );
            void setCarry(type, category, Number(input.val()));
            input.trigger("blur");
        }
    });
    $(".stash-right").on("click", ".stash-stepper-btn", (event) => {
        const btn = $(event.currentTarget);
        const item = btn.closest(".stash-item");
        const type = String(item.data("type") ?? "");
        const category = String(item.data("category") ?? "");
        const direction = Number(btn.data("step") ?? 1);
        void adjustCarry(type, category, direction);
    });
}

export function initExtractionStashUi(): void {
    const btn = $("#btn-extraction-stash");
    if (!btn.length) return;

    // 仓库是独立全屏页面（/storage）；大厅按钮直接跳转。
    btn.on("click", () => {
        window.location.href = "/storage";
    });
}

// ---------- 商店（经济系统） ----------

export interface ShopCatalogItem {
    type: string;
    category: string;
    name: string;
    /** 买入价；null 表示不可购买。 */
    buy: number | null;
    /** 卖出价；null 表示不可出售。 */
    sell: number | null;
    sellOnly: boolean;
    owned: number;
}

interface ShopCatalogData {
    coins: number;
    items: ShopCatalogItem[];
    oneTimePerks?: Array<{
        type: string;
        name: string;
        banned: boolean;
        /** 仓库持有数量（0 = 未购买；可继续购买同类型）。 */
        owned: number;
    }>;
    oneTimePerkPrice?: number;
}

export let shopCoins = 0;
let shopLoadSeq = 0;

const SHOP_CATEGORY_LABELS: Record<string, string> = {
    guns: "枪械",
    ammo: "弹药",
    consumables: "药品",
    throwables: "投掷物",
    melee: "近战",
    helmets: "头盔",
    chests: "护甲",
    backpacks: "背包",
    scopes: "倍镜",
};

/** 弹药一次买卖的数量（普通弹 30 发；308sub 5 发；信号弹 1 发）。 */
function ammoStep(type: string): number {
    if (type === "flare") return 1;
    if (type === "308sub") return 5;
    return 30;
}

function shopStep(category: string, type: string): number {
    if (category === "ammo") return ammoStep(type);
    return 1;
}

export function updateShopCoins(): void {
    const text = `${shopCoins.toLocaleString()} 金币`;
    $("#storage-coins").text(text);
    $("#storage-shop-coins").text(text);
}

export function renderShop(data: ShopCatalogData): void {
    const items = data.items ?? [];
    const grid = $("#shop-grid");
    if (!grid.length) return;
    grid.empty();
    const order = [
        "guns",
        "ammo",
        "consumables",
        "throwables",
        "melee",
        "helmets",
        "chests",
        "backpacks",
        "scopes",
    ];
    for (const category of order) {
        const list = items.filter((item) => item.category === category);
        if (list.length === 0) continue;
        const section = $(
            `<div class='stash-section shop-section'><h3>${SHOP_CATEGORY_LABELS[category] ?? category}</h3>`
                + `<div class='stash-grid shop-grid'></div></div>`,
        );
        const cell = section.find(".shop-grid");
        for (const item of list) {
            const buyText = item.buy === null ? "不可购买" : `${item.buy.toLocaleString()}`;
            const sellText = item.sell === null ? "—" : `${item.sell.toLocaleString()}`;
            // S/S+ / 信号弹等仅出售（不可购买）；近战可购买（定价 1000）。
            const isSellOnlyItem = item.buy === null && item.sell !== null;
            const buyBtn = item.buy === null
                ? ""
                : `<button type='button' class='shop-btn buy' data-type='${esc(item.type)}'>购买</button>`;
            cell.append(
                `<div class='shop-item ${isSellOnlyItem ? "sell-only" : ""}' title='${esc(item.name)}'>`
                    + `<img src='${itemImage(item.type)}' alt='' draggable='false'/>`
                    + `<div class='stash-item-name'>${esc(item.name)}</div>`
                    + `<div class='stash-item-count'>仓库 x${item.owned.toLocaleString()}</div>`
                    + `<div class='shop-price buy'>买入 <b>${buyText}</b></div>`
                    + `<div class='shop-price sell'>出售 <b>${sellText}</b></div>`
                    + `<div class='shop-actions'>${buyBtn}</div>`
                    + `</div>`,
            );
        }
        grid.append(section);
    }
    // 一次性能力：购买后先存入仓库，由玩家手动选择携带。
    if (data.oneTimePerks && data.oneTimePerks.length > 0) {
        const price = data.oneTimePerkPrice ?? 3000;
        const section = $(
            `<div class='stash-section shop-section shop-one-time-section'><h3>一次性能力（仅限一局）</h3>`
                + `<div class='shop-one-time-hint'>购买后存入仓库，需在仓库中手动勾选本局携带；选中的进局提供额外技能槽（每个 +1 槽位）并消耗，未选中的保留下次可用。</div>`
                + `<div class='stash-grid shop-grid'></div></div>`,
        );
        const cell = section.find(".shop-grid");
        for (const item of data.oneTimePerks) {
            // 允许购买多个同类型：已持有仍显示数量并可继续购买。
            const status = item.banned
                ? `<div class='shop-price buy'>不可购买</div>`
                : item.owned > 0
                ? `<div class='shop-price buy'>仓库 x${item.owned}</div>`
                : `<div class='shop-price buy'>买入 <b>${price.toLocaleString()}</b></div>`;
            const btn = item.banned
                ? ""
                : `<button type='button' class='shop-btn buy one-time-perk-buy' data-type='${
                    esc(item.type)
                }'>购买</button>`;
            cell.append(
                `<div class='shop-item shop-one-time-item ${item.owned > 0 ? "owned" : ""} ${
                    item.banned ? "banned" : ""
                }' title='${esc(item.name)}'>`
                    + `<img src='${itemImage(item.type)}' alt='' draggable='false'/>`
                    + `<div class='stash-item-name'>${esc(item.name)}</div>`
                    + `${status}`
                    + `<div class='shop-actions'>${btn}</div>`
                    + `</div>`,
            );
        }
        grid.append(section);
    }
    // 数量/余额变化后同步刷新出售视图（若已切到出售）。
    if (!$("#shop-sell-view").is(":hidden")) renderShopSell();
}

export async function loadShop(): Promise<void> {
    const token = sessionToken();
    if (!token) {
        setStatus("请先登录后使用商店", true);
        return;
    }
    const seq = ++shopLoadSeq;
    try {
        const data = await api<ShopCatalogData>(
            `/api/shop/catalog?token=${encodeURIComponent(token)}`,
        );
        if (seq !== shopLoadSeq) return;
        shopCoins = Number(data.coins) || 0;
        setLastShopItems(data.items ?? []);
        updateShopCoins();
        renderShop(data);
        renderShopSell();
    } catch (error) {
        if (seq !== shopLoadSeq) return;
        setStatus(
            `商店加载失败：${error instanceof Error ? error.message : String(error)}`,
            true,
        );
    }
}

async function shopAction(action: "buy" | "sell", type: string): Promise<void> {
    const token = sessionToken();
    if (!token) {
        setStatus("请先登录后使用商店", true);
        return;
    }
    const item = shopCatalogItem(type);
    const step = shopStep(item?.category ?? "", type);
    try {
        const result = await api<{
            ok?: boolean;
            reason?: string;
            coins?: number;
        }>(`/api/shop/${action}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, type, count: step }),
        });
        if (!result.ok) {
            setStatus(
                `${action === "buy" ? "购买" : "出售"}失败：${result.reason ?? "未知原因"}`,
                true,
            );
            return;
        }
        if (typeof result.coins === "number") {
            shopCoins = result.coins;
            updateShopCoins();
        }
        if (action === "buy") {
            const label = shopCatalogItem(type)?.name ?? type;
            flashStatus(`购买成功：${label} ×${step} 已存入仓库`);
            setStatus(`购买成功：${label} ×${step} 已存入仓库`);
        } else {
            setStatus("已出售，金币已到账");
        }
        // 同时刷新仓库（数量变化）与商店（余额/库存）。
        await Promise.all([loadStash(), loadShop()]);
    } catch (error) {
        setStatus(
            `${action === "buy" ? "购买" : "出售"}失败：${error instanceof Error ? error.message : String(error)}`,
            true,
        );
    }
}

function shopCatalogItem(type: string): ShopCatalogItem | undefined {
    // 从上次加载的目录里找（缓存一份以避免重复请求）。
    return lastShopItems.find((item) => item.type === type);
}

let lastShopItems: ShopCatalogItem[] = [];

/** 出售视图：每种物品当前选择的出售数量（type → count）。 */
let sellSelections: Record<string, number> = {};

/** 物品可出售数量 = 仓库总量 - 身上（已装备/携带）数量。 */
function sellableAmount(item: ShopCatalogItem): number {
    const owned = Math.max(0, Number(item.owned) || 0);
    const reserved = reservedAmount(item.type, item.category);
    return Math.max(0, owned - reserved);
}

/** 出售视图：把配装展示界面替换为仓库可出售物资列表。 */
export function renderShopSell(): void {
    const list = $("#shop-sell-list");
    if (!list.length) return;
    list.empty();
    const items = lastShopItems.filter(
        (item) => item.sell !== null && (Number(item.owned) || 0) > 0,
    );
    if (items.length === 0) {
        list.html("<div class='stash-empty'>仓库没有可出售的物资</div>");
        updateSellSummary();
        return;
    }
    const order = [
        "guns",
        "ammo",
        "consumables",
        "throwables",
        "melee",
        "helmets",
        "chests",
        "backpacks",
        "scopes",
    ];
    for (const category of order) {
        const listItems = items.filter((item) => item.category === category);
        if (listItems.length === 0) continue;
        const section = $(
            `<div class='stash-section shop-sell-section'><h3>${SHOP_CATEGORY_LABELS[category] ?? category}</h3>`
                + `<div class='shop-sell-grid'></div></div>`,
        );
        const cell = section.find(".shop-sell-grid");
        for (const item of listItems) {
            const available = sellableAmount(item);
            const reserved = Math.max(0, (Number(item.owned) || 0) - available);
            const selected = Math.min(
                Math.max(0, Math.floor(Number(sellSelections[item.type]) || 0)),
                available,
            );
            cell.append(
                `<div class='shop-sell-item' data-type='${esc(item.type)}'>`
                    + `<img src='${itemImage(item.type)}' alt='' draggable='false'/>`
                    + `<div class='shop-sell-name' title='${esc(item.name)}'>${esc(item.name)}</div>`
                    + `<div class='shop-sell-count' title='仓库 ${item.owned}；身上（已装备/携带）${reserved}'>`
                    + `可售 <b>${available}</b></div>`
                    + `<div class='shop-sell-price'>${item.sell!.toLocaleString()} 金币/件</div>`
                    + `<div class='shop-sell-controls'>`
                    + `<input type='number' class='shop-sell-input' min='0' max='${available}' value='${selected}' title='出售数量（最多可售 ${available}）' />`
                    + `<button type='button' class='shop-sell-all-btn' data-type='${
                        esc(item.type)
                    }' title='选择全部可售数量'>全部</button>`
                    + `</div>`
                    + `</div>`,
            );
        }
        list.append(section);
    }
    updateSellSummary();
}

function updateSellSummary(): void {
    let count = 0;
    let total = 0;
    for (const item of lastShopItems) {
        if (item.sell === null) continue;
        const selected = Math.min(
            Math.max(0, Math.floor(Number(sellSelections[item.type]) || 0)),
            sellableAmount(item),
        );
        if (selected <= 0) continue;
        count += selected;
        total += selected * item.sell;
    }
    $("#shop-sell-summary").text(
        `已选 ${count} 件 · 预计收入 ${total.toLocaleString()} 金币`,
    );
    const btn = document.getElementById("shop-sell-all");
    if (btn) (btn as HTMLButtonElement).disabled = count <= 0;
}

/** 批量出售：先确认，再逐项提交。 */
async function bulkSell(): Promise<void> {
    const token = sessionToken();
    if (!token) {
        setStatus("请先登录后使用商店", true);
        return;
    }
    const rows: Array<{
        type: string;
        name: string;
        count: number;
        income: number;
    }> = [];
    for (const item of lastShopItems) {
        if (item.sell === null) continue;
        const selected = Math.min(
            Math.max(0, Math.floor(Number(sellSelections[item.type]) || 0)),
            sellableAmount(item),
        );
        if (selected <= 0) continue;
        rows.push({
            type: item.type,
            name: item.name,
            count: selected,
            income: selected * item.sell,
        });
    }
    if (rows.length === 0) return;
    const totalCount = rows.reduce((sum, row) => sum + row.count, 0);
    const totalIncome = rows.reduce((sum, row) => sum + row.income, 0);
    const preview = rows
        .slice(0, 5)
        .map((row) => `${row.name}×${row.count}`)
        .join("、");
    const summary = `${preview}${rows.length > 5 ? ` 等 ${rows.length} 种` : ""}`;
    if (
        !window.confirm(
            `确认出售 ${totalCount} 件物资（${summary}）？\n预计收入 ${totalIncome.toLocaleString()} 金币。`,
        )
    ) {
        return;
    }
    let soldCount = 0;
    let income = 0;
    let failed = 0;
    for (const row of rows) {
        const result = await api<{
            ok?: boolean;
            reason?: string;
            coins?: number;
        }>("/api/shop/sell", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                token,
                type: row.type,
                count: row.count,
            }),
        });
        if (result.ok) {
            soldCount += row.count;
            income += row.income;
            if (typeof result.coins === "number") {
                shopCoins = result.coins;
                updateShopCoins();
            }
        } else {
            failed += 1;
        }
    }
    sellSelections = {};
    await Promise.all([loadStash(), loadShop()]);
    renderShopSell();
    if (failed === 0) {
        setStatus(
            `批量出售成功：${soldCount} 件，收入 ${income.toLocaleString()} 金币`,
        );
    } else {
        setStatus(
            `批量出售完成：成功 ${soldCount} 件，${failed} 项失败（可能已出售或身上占用）`,
            true,
        );
    }
}

/** 购买成功的高亮提示（短暂闪烁后恢复）。 */
function flashStatus(text: string): void {
    const el = $("#extraction-stash-status");
    el.text(text).css("color", "#7dffa8");
    el.addClass("shop-flash");
    window.setTimeout(() => el.removeClass("shop-flash"), 1800);
}

/** 购买一次性能力：存入仓库，不自动写入当前配装。 */
async function buyOneTimePerk(type: string): Promise<void> {
    const token = sessionToken();
    if (!token) {
        setStatus("请先登录后使用商店", true);
        return;
    }
    const beforeCount = oneTimePerkItems.filter((item) => item === type).length;
    const selector = `.one-time-perk-buy[data-type='${CSS.escape(type)}']`;
    const button = $(selector);
    button.prop("disabled", true).text("购买中…");
    try {
        const result = await api<{
            ok?: boolean;
            reason?: string;
            coins?: number;
            /** 服务端在同一持久化事务中返回的完整一次性技能仓库。 */
            oneTimePerks?: string[];
        }>(`/api/shop/one-time-perk/buy`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, type }),
        });
        if (!result.ok) {
            setStatus(`购买失败：${result.reason ?? "未知原因"}`, true);
            return;
        }
        if (typeof result.coins === "number") {
            shopCoins = result.coins;
            updateShopCoins();
        }
        // 不等待后续 GET 才显示：购买响应只有在仓库已成功落盘后才返回，
        // 因此可直接采用这份权威快照。正式服即使刷新请求稍有延迟，玩家
        // 也会立即在仓库看到刚购买的技能。
        if (Array.isArray(result.oneTimePerks)) {
            oneTimePerkItems = result.oneTimePerks.filter(
                (item): item is string => typeof item === "string" && item.length > 0,
            );
            renderRight();
        }
        // 串行刷新权威快照，避免商店/仓库的旧 GET 响应倒序覆盖购买结果。
        await loadStash();
        await loadShop();
        // 购买成功却未能从仓库重新读到新增项时，不再误报“已存入”。
        // 再读一次以覆盖跨进程文件系统的极短可见性延迟；仍不一致则明确报错。
        if (oneTimePerkItems.filter((item) => item === type).length <= beforeCount) {
            await loadStash();
        }
        if (oneTimePerkItems.filter((item) => item === type).length <= beforeCount) {
            setStatus("购买已扣款，但仓库校验失败，请联系管理员检查数据目录", true);
            return;
        }
        flashStatus(`已存入仓库，请在仓库选择携带：${itemName(type)}`);
    } catch (error) {
        setStatus(
            `购买失败：${error instanceof Error ? error.message : String(error)}`,
            true,
        );
    } finally {
        $(selector).prop("disabled", false).text("购买");
    }
}

// 一次性技能允许同类重复购买，但每次购买都会返回“完整库存快照”。
// 将购买请求串行化，避免快速连续点击时较旧响应后到并覆盖较新库存。
let oneTimePerkPurchaseQueue: Promise<void> = Promise.resolve();

function enqueueOneTimePerkPurchase(type: string): Promise<void> {
    const queued = oneTimePerkPurchaseQueue.then(() => buyOneTimePerk(type));
    oneTimePerkPurchaseQueue = queued.catch(() => undefined);
    return queued;
}

export function bindShopEvents(): void {
    $("#shop-grid").on("click", (event) => {
        const button = (event.target as HTMLElement).closest("button.shop-btn");
        if (!button) return;
        const type = String($(button).attr("data-type") ?? "");
        if (!type) return;
        // 一次性能力使用独立购买接口，成功后仅入库。
        if (button.classList.contains("one-time-perk-buy")) {
            void enqueueOneTimePerkPurchase(type);
            return;
        }
        const action = button.classList.contains("buy") ? "buy" : "sell";
        void shopAction(action, type);
    });
    // 出售列表：数量输入 / 全部。
    $("#shop-sell-list").on("input", (event) => {
        const input = (event.target as HTMLElement).closest(
            "input.shop-sell-input",
        ) as HTMLInputElement | null;
        if (!input) return;
        const type = String(
            $(input).closest(".shop-sell-item").attr("data-type") ?? "",
        );
        if (!type) return;
        const item = shopCatalogItem(type);
        const max = item ? sellableAmount(item) : 0;
        const value = Math.min(
            max,
            Math.max(0, Math.floor(Number(input.value) || 0)),
        );
        sellSelections[type] = value;
        input.value = String(value);
        updateSellSummary();
    });
    $("#shop-sell-list").on("click", (event) => {
        const button = (event.target as HTMLElement).closest(
            "button.shop-sell-all-btn",
        );
        if (!button) return;
        const type = String($(button).attr("data-type") ?? "");
        const item = shopCatalogItem(type);
        if (!item) return;
        sellSelections[type] = sellableAmount(item);
        const input = $(button)
            .closest(".shop-sell-item")
            .find("input.shop-sell-input");
        if (input.length) input.val(String(sellSelections[type]));
        updateSellSummary();
    });
    $("#shop-sell-all").on("click", () => void bulkSell());
}

export function setLastShopItems(items: ShopCatalogItem[]): void {
    lastShopItems = items ?? [];
}
