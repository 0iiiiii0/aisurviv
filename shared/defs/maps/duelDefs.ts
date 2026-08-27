import { GameConfig } from "../../gameConfig.ts";
import { util } from "../../utils/util.ts";
import { v2 } from "../../utils/v2.ts";
import { Main, type PartialMapDef } from "./baseDefs.ts";

// A compact, deterministic arena. Every gameplay object and item is mirrored
// across the vertical center line so neither spawn receives an advantage.
const mapDef: PartialMapDef = {
    mapId: GameConfig.MapId.Duel,
    desc: {
        name: "Duel Arena",
        icon: "/img/gui/duel-arena-emblem.png",
        buttonCss: "btn-mode-duel",
        buttonText: "duel",
    },
    biome: {
        colors: {
            background: 0x101820,
            water: 0x18344f,
            waterRipple: 0x8ac6d1,
            beach: 0x9aa6a6,
            riverbank: 0x596a70,
            grass: 0x607b6b,
            underground: 0x1b2630,
            playerSubmerge: 0x18344f,
            playerGhillie: 0x607b6b,
        },
        valueAdjust: 0.92,
    },
    gameMode: {
        maxPlayers: 2,
        killLeaderEnabled: false,
    },
    gameConfig: {
        planes: {
            timings: [],
            crates: [],
        },
    },
    arena: {
        lockPlayersUntilFull: true,
        rounds: {
            total: 5,
            resetDelay: 2,
        },
        gas: {
            duration: 180,
            // Gas ticks every two seconds. Eight damage per tick keeps the
            // arena gas decisively ahead of the 1.75 HP/s maximum boost heal.
            damage: 8,
        },
        startingLoadout: {
            weapons: [{ type: "m4a1" }, { type: "mk12" }],
            activeWeaponSlot: 0,
            backpack: "backpack03",
            helmet: "helmet02",
            chest: "chest02",
            scope: "4xscope",
            boost: 100,
            perks: ["endless_ammo"],
            inventory: {
                bandage: 0xfff,
                healthkit: 0xfff,
                soda: 0xfff,
                painkiller: 0xfff,
            },
        },
        emblem: {
            image: "/img/gui/duel-arena-emblem.png",
            size: 32,
            alpha: 0.78,
            leftColor: 0xc83b35,
            rightColor: 0x3478d4,
        },
        playerSpawns: [v2.create(0.2, 0.5), v2.create(0.8, 0.5)],
        objects: [
            // Permanent cover keeps reliable fallback routes in every round.
            // Sandbags are indestructible and arranged symmetrically.
            { type: "sandbags_01", pos: v2.create(0.5, 0.19), ori: 0 },
            { type: "sandbags_01", pos: v2.create(0.5, 0.81), ori: 0 },
            { type: "sandbags_01", pos: v2.create(0.28, 0.43), ori: 1 },
            { type: "sandbags_01", pos: v2.create(0.72, 0.43), ori: 1 },
            { type: "sandbags_01", pos: v2.create(0.28, 0.57), ori: 1 },
            { type: "sandbags_01", pos: v2.create(0.72, 0.57), ori: 1 },

            // Central cover creates three viable lanes around the emblem.
            { type: "stone_01", pos: v2.create(0.5, 0.36), scale: 1.15 },
            { type: "stone_01", pos: v2.create(0.5, 0.64), scale: 1.15 },
            { type: "crate_01", pos: v2.create(0.42, 0.5), ori: 0 },
            { type: "crate_01", pos: v2.create(0.58, 0.5), ori: 0 },

            // Mirrored lane cover.
            { type: "barrel_01", pos: v2.create(0.31, 0.34) },
            { type: "barrel_01", pos: v2.create(0.69, 0.34) },
            { type: "barrel_01", pos: v2.create(0.31, 0.66) },
            { type: "barrel_01", pos: v2.create(0.69, 0.66) },
            { type: "stone_01", pos: v2.create(0.22, 0.27), scale: 0.85 },
            { type: "stone_01", pos: v2.create(0.78, 0.27), scale: 0.85 },
            { type: "stone_01", pos: v2.create(0.22, 0.73), scale: 0.85 },
            { type: "stone_01", pos: v2.create(0.78, 0.73), scale: 0.85 },

            // Additional symmetric cover closes the long sight lines without
            // blocking either spawn or removing the three-lane layout.
            { type: "crate_01", pos: v2.create(0.36, 0.24), ori: 0 },
            { type: "crate_01", pos: v2.create(0.64, 0.24), ori: 0 },
            { type: "crate_01", pos: v2.create(0.36, 0.76), ori: 0 },
            { type: "crate_01", pos: v2.create(0.64, 0.76), ori: 0 },
            { type: "stone_01", pos: v2.create(0.34, 0.5), scale: 0.9 },
            { type: "stone_01", pos: v2.create(0.66, 0.5), scale: 0.9 },
        ],
        // Duel equipment is granted immediately on spawn, so the arena has no
        // ground loot that could give either side a pickup timing advantage.
        loot: [],
    },
    /* STRIP_FROM_PROD_CLIENT:START */
    mapGen: {
        map: {
            baseWidth: 176,
            // Keep the horizontal duel distance while tightening the top and
            // bottom lanes into a faster rectangular arena.
            baseHeight: 136,
            scale: { small: 1, large: 1 },
            extension: 0,
            shoreInset: 14,
            grassInset: 6,
            rivers: {
                lakes: [],
                weights: [{ weight: 1, widths: [] }],
                smoothness: 0.45,
                masks: [],
            },
        },
        places: [{ name: "Duel Arena", pos: v2.create(0.5, 0.5) }],
        bridgeTypes: { medium: "", large: "", xlarge: "" },
        customSpawnRules: {
            locationSpawns: [],
            placeSpawns: [],
        },
        densitySpawns: [{}],
        fixedSpawns: [{}],
        randomSpawns: [{ spawns: [], choose: 0 }],
        spawnReplacements: [{}],
        importantSpawns: [],
    },
    /* STRIP_FROM_PROD_CLIENT:END */
};

export const Duel = util.mergeDeep({}, Main, mapDef);
