export interface SandevistanChipDef {
    readonly type: "sandevistan";
    name: string;
    lootImg: {
        sprite: string;
        tint: number;
        border: string;
        borderTint: number;
        scale: number;
    };
    sound: {
        pickup: string;
    };
}

/**
 * The Sandevistan implant chip. In the dedicated mode every contestant owns it
 * at spawn; pressing Use activates the world time-dilation. The item is also a
 * reusable loot target for future drop-based variants.
 */
export const SandevistanChipDefs: Record<string, SandevistanChipDef> = {
    sandevistan_chip: {
        name: "Sandevistan",
        type: "sandevistan",
        lootImg: {
            sprite: "loot-perk-windwalk.img",
            tint: 0xffffff,
            border: "loot-circle-outer-03.img",
            borderTint: 0xffffff,
            scale: 0.275,
        },
        sound: {
            pickup: "perk_pickup_01",
        },
    },
};
