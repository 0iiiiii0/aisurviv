import { GameConfig } from "../../../shared/gameConfig.ts";

export const MEDICAL_SHARE_ITEMS = [
    "bandage",
    "healthkit",
    "soda",
    "painkiller",
] as const;

export type MedicalShareItem = (typeof MEDICAL_SHARE_ITEMS)[number];

export interface MedicalInventorySnapshot {
    bandage: number;
    healthkit: number;
    soda: number;
    painkiller: number;
}

export function isMedicalRequestEmote(type: string): boolean {
    return type === "emote_medical";
}

/** Mirrors Player.dropItem for heal/boost stacks. */
export function predictedMedicalDropAmount(inventoryCount: number): number {
    const count = Math.max(0, Math.floor(inventoryCount));
    if (count <= 0) return 0;
    return Math.max(1, Math.floor(count / 2));
}

/**
 * Reserve enough medicine for the donor to survive the next fight. Human
 * requests may use the slightly smaller bandage reserve, but rare single-use
 * items are never donated if that would leave the donor with none.
 */
export function medicalReserveCount(
    item: MedicalShareItem,
    humanEmergency: boolean,
): number {
    switch (item) {
        case "bandage":
            return humanEmergency ? 2 : 3;
        case "healthkit":
        case "soda":
        case "painkiller":
            return 1;
    }
}

export function canDonateMedicalItem(input: {
    item: MedicalShareItem;
    inventoryCount: number;
    humanEmergency: boolean;
}): boolean {
    const count = Math.max(0, Math.floor(input.inventoryCount));
    if (count >= GameConfig.inventoryInfiniteCount) return false;
    const amount = predictedMedicalDropAmount(count);
    if (amount <= 0) return false;
    return count - amount >= medicalReserveCount(input.item, input.humanEmergency);
}

/**
 * A bot only asks the squad for medicine when its own stock is no longer
 * adequate for the current injury. This avoids constant supply shuffling.
 */
export function botNeedsMedicalSupport(input: {
    health: number;
    bandage: number;
    healthkit: number;
    soda: number;
    painkiller: number;
}): boolean {
    const health = Math.max(0, Math.min(100, Number(input.health) || 0));
    const bandage = Math.max(0, Math.floor(input.bandage));
    const healthkit = Math.max(0, Math.floor(input.healthkit));
    const soda = Math.max(0, Math.floor(input.soda));
    const painkiller = Math.max(0, Math.floor(input.painkiller));

    if (health <= 35) return healthkit <= 0 && bandage < 3;
    if (health <= 58) return healthkit <= 0 && bandage < 2;
    if (health <= 78) return healthkit <= 0 && bandage <= 0;

    // A nearly healthy bot does not request healing, but one with no medical
    // resources at all may ask once it has taken meaningful damage.
    return health < 90 && bandage + healthkit + soda + painkiller === 0;
}

export function medicalInventoryFromRecord(
    inventory: Readonly<Record<string, number>>,
): MedicalInventorySnapshot {
    return {
        bandage: Number(inventory.bandage ?? 0),
        healthkit: Number(inventory.healthkit ?? 0),
        soda: Number(inventory.soda ?? 0),
        painkiller: Number(inventory.painkiller ?? 0),
    };
}

/**
 * Pick the most useful shareable item for the recipient's current health while
 * preserving the donor's reserve. Direct healing is preferred for injured
 * teammates; boosts are fallback supplies rather than replacements for a medkit.
 */
export function chooseMedicalDonation(input: {
    inventory: Readonly<Record<string, number>>;
    recipientHealth: number;
    humanEmergency: boolean;
}): MedicalShareItem | null {
    const health = Math.max(0, Math.min(100, Number(input.recipientHealth) || 0));
    const order: readonly MedicalShareItem[] = health <= 45
        ? ["healthkit", "bandage", "soda", "painkiller"]
        : health <= 82
        ? ["bandage", "healthkit", "soda", "painkiller"]
        : ["soda", "bandage", "painkiller", "healthkit"];

    for (const item of order) {
        if (
            canDonateMedicalItem({
                item,
                inventoryCount: Number(input.inventory[item] ?? 0),
                humanEmergency: input.humanEmergency,
            })
        ) {
            return item;
        }
    }
    return null;
}
