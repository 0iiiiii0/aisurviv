import type { DuelThrowables } from "./duelLoadout.ts";

export type DuelWeaponSelectionMode = "individual" | "mirrored" | "exclusive";

export interface DuelPlayerWeapons {
    weapons: [string, string];
    /**
     * Per-player throwables for real-vs-real 1v1 lobbies. When absent
     * (for example the admin pure-AI duel flow) the shared duelThrowables
     * config is used as the fallback for every contestant.
     */
    throwables?: DuelThrowables;
}

export function isDuelWeaponSelectionMode(value: unknown): value is DuelWeaponSelectionMode {
    return value === "individual" || value === "mirrored" || value === "exclusive";
}

export function cloneDuelPlayerWeapons(value: DuelPlayerWeapons): DuelPlayerWeapons {
    return {
        weapons: [value.weapons[0], value.weapons[1]],
        ...(value.throwables ? { throwables: { ...value.throwables } } : {}),
    };
}
