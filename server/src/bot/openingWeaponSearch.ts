export const OPENING_WEAPON_SEARCH_WINDOW_MS = 20_000;

export interface OpeningWeaponSearchProfile {
    opening: boolean;
    gunUrgency: number;
    gunRange: number;
    lootLockMs: number;
    crateRangeMultiplier: number;
}

/**
 * Spawn-time gun acquisition uses a bounded, high-commitment sweep. The window
 * is long enough for a late worker to reach the nearest building, but expires
 * before normal tactical decisions should take over.
 */
export function openingWeaponSearchProfile(
    noUsableGun: boolean,
    ageMs: number,
    potatoMode = false,
): OpeningWeaponSearchProfile {
    const opening = noUsableGun && ageMs >= 0 && ageMs <= OPENING_WEAPON_SEARCH_WINDOW_MS;
    if (potatoMode) {
        return {
            opening,
            gunUrgency: noUsableGun ? (opening ? 1480 : 1180) : 520,
            gunRange: noUsableGun ? (opening ? 124 : 96) : 48,
            lootLockMs: noUsableGun ? (opening ? 7200 : 6500) : 3200,
            crateRangeMultiplier: noUsableGun ? (opening ? 2.2 : 1.8) : 1.35,
        };
    }
    return {
        opening,
        gunUrgency: noUsableGun ? (opening ? 1380 : 900) : 330,
        gunRange: noUsableGun ? (opening ? 108 : 72) : 27,
        lootLockMs: noUsableGun ? (opening ? 5200 : 3800) : 1800,
        crateRangeMultiplier: noUsableGun ? (opening ? 2.05 : 1.55) : 1.35,
    };
}
