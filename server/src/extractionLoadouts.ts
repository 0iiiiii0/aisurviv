import { RawGameObjectDefs as GameObjectDefs } from "../../shared/defs/gameObjectDefs.ts";
import type { GrantedLoadout } from "./stash/stashManager.ts";

/**
 * AI default loadouts for the 搜打撤 mode. Multiple presets can be configured
 * in the admin backend and each bot rolls one by weight.
 */
export interface ExtractionLoadoutSpec {
    guns: string[];
    ammo: Record<string, number>;
    consumables: Record<string, number>;
    armor: {
        helmet?: string;
        chest?: string;
        backpack?: string;
        scope?: string;
    };
}

export interface ExtractionAiLoadoutPreset {
    name: string;
    weight: number;
    loadout: ExtractionLoadoutSpec;
}

export const defaultExtractionAiLoadouts: ExtractionAiLoadoutPreset[] = [
    {
        name: "标准突击",
        weight: 40,
        loadout: {
            guns: ["ak47"],
            ammo: { "762mm": 90 },
            consumables: { bandage: 4, soda: 1 },
            armor: { backpack: "backpack01", helmet: "helmet01", chest: "chest01" },
        },
    },
    {
        name: "轻装游走",
        weight: 25,
        loadout: {
            guns: ["mp5"],
            ammo: { "9mm": 90 },
            consumables: { bandage: 3 },
            armor: { backpack: "backpack01" },
        },
    },
    {
        name: "重装火力",
        weight: 20,
        loadout: {
            guns: ["m249"],
            ammo: { "556mm": 120 },
            consumables: { bandage: 5, healthkit: 1, soda: 2 },
            armor: { backpack: "backpack02", helmet: "helmet02", chest: "chest02", scope: "2xscope" },
        },
    },
    {
        name: "精确射手",
        weight: 15,
        loadout: {
            guns: ["mosin"],
            ammo: { "762mm": 40 },
            consumables: { bandage: 2, painkiller: 1 },
            armor: { backpack: "backpack01", scope: "4xscope" },
        },
    },
];

/**
 * 绝密模式 AI 默认配装：与普通搜打撤 AI 完全独立。绝密 AI 是"最终幸存者"，
 * 配装明显更强（A/S 级武器、三级护甲、倍镜、更充足的医疗）。
 */
export const defaultExtractionSecretAiLoadouts: ExtractionAiLoadoutPreset[] = [
    {
        name: "绝密突击",
        weight: 40,
        loadout: {
            guns: ["m4a1"],
            ammo: { "556mm": 180 },
            consumables: { bandage: 6, healthkit: 2, soda: 3 },
            armor: {
                backpack: "backpack02",
                helmet: "helmet02",
                chest: "chest02",
                scope: "4xscope",
            },
        },
    },
    {
        name: "绝密狙击",
        weight: 30,
        loadout: {
            guns: ["sv98"],
            ammo: { "762mm": 60 },
            consumables: { bandage: 4, painkiller: 2 },
            armor: {
                backpack: "backpack02",
                helmet: "helmet02",
                chest: "chest02",
                scope: "8xscope",
            },
        },
    },
    {
        name: "绝密重装",
        weight: 30,
        loadout: {
            guns: ["m249"],
            ammo: { "556mm": 240 },
            consumables: { bandage: 6, healthkit: 2, soda: 2 },
            armor: {
                backpack: "backpack02",
                helmet: "helmet02",
                chest: "chest02",
                scope: "2xscope",
            },
        },
    },
];

function normalizeCount(raw: unknown, cap: number): number {
    const count = Math.max(0, Math.floor(Number(raw) || 0));
    return Math.min(cap, count);
}

export function normalizePreset(
    preset: Partial<ExtractionAiLoadoutPreset> | undefined,
): ExtractionAiLoadoutPreset | null {
    if (!preset || typeof preset !== "object") return null;
    const guns = Array.isArray(preset.loadout?.guns)
        ? preset.loadout.guns
            .filter((type) => GameObjectDefs[type]?.type === "gun")
            .slice(0, 2)
        : [];
    const ammo: Record<string, number> = {};
    const consumables: Record<string, number> = {};
    for (const [type, count] of Object.entries(preset.loadout?.ammo ?? {})) {
        if (GameObjectDefs[type]?.type === "ammo") {
            const value = normalizeCount(count, 300);
            if (value > 0) ammo[type] = value;
        }
    }
    for (const [type, count] of Object.entries(preset.loadout?.consumables ?? {})) {
        if (GameObjectDefs[type] && (GameObjectDefs[type]?.type === "heal" || GameObjectDefs[type]?.type === "boost")) {
            const value = normalizeCount(count, 30);
            if (value > 0) consumables[type] = value;
        }
    }
    const armor: ExtractionLoadoutSpec["armor"] = {};
    for (const key of ["helmet", "chest", "backpack", "scope"] as const) {
        const type = preset.loadout?.armor?.[key];
        if (type && GameObjectDefs[type]?.type === key) armor[key] = type;
    }
    const name = String(preset.name ?? "未命名配装").slice(0, 24);
    const weight = Math.max(0, Math.floor(Number(preset.weight) || 0));
    return { name, weight, loadout: { guns, ammo, consumables, armor } };
}

export function pickWeightedExtractionLoadout(
    presets: readonly ExtractionAiLoadoutPreset[],
): ExtractionLoadoutSpec | null {
    const valid = presets
        .map(normalizePreset)
        .filter((preset): preset is ExtractionAiLoadoutPreset => preset !== null && preset.weight > 0);
    if (valid.length === 0) return null;
    const total = valid.reduce((sum, preset) => sum + preset.weight, 0);
    let roll = Math.random() * total;
    for (const preset of valid) {
        roll -= preset.weight;
        if (roll <= 0) return preset.loadout;
    }
    return valid[valid.length - 1].loadout;
}

/** Converts an AI preset loadout into the arena starting-loadout shape. */
export function specToGrantedLoadout(spec: ExtractionLoadoutSpec): GrantedLoadout {
    const weapons: Array<{ type: string; ammo?: number }> = [];
    const inventory: Record<string, number> = {};
    for (const gunType of spec.guns.slice(0, 2)) {
        const def = GameObjectDefs[gunType] as
            | { type: string; maxClip?: number; ammo?: string }
            | undefined;
        if (def?.type !== "gun") continue;
        const maxClip = Math.max(1, Math.floor(Number(def.maxClip ?? 30)));
        weapons.push({ type: gunType, ammo: maxClip });
        const ammoType = String(def.ammo ?? "");
        if (ammoType && spec.ammo[ammoType]) {
            inventory[ammoType] = Math.min(300, Math.max(0, spec.ammo[ammoType]));
        }
    }
    for (const [type, count] of Object.entries(spec.ammo)) {
        if (inventory[type] === undefined && GameObjectDefs[type]?.type === "ammo") {
            inventory[type] = Math.min(300, Math.max(0, count));
        }
    }
    for (const [type, count] of Object.entries(spec.consumables)) {
        if (GameObjectDefs[type] && count > 0) inventory[type] = Math.min(30, count);
    }
    const loadout: GrantedLoadout = { weapons };
    // 统一为 2 个固定武器槽位：空槽用 { type: "" } 占位。
    while (weapons.length < 2) weapons.push({ type: "" });
    if (Object.keys(inventory).length > 0) loadout.inventory = inventory;
    if (spec.armor.helmet) loadout.helmet = spec.armor.helmet;
    if (spec.armor.chest) loadout.chest = spec.armor.chest;
    if (spec.armor.backpack) loadout.backpack = spec.armor.backpack;
    if (spec.armor.scope) loadout.scope = spec.armor.scope;
    return loadout;
}
