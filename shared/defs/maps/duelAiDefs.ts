import { GameConfig } from "../../gameConfig.ts";
import { util } from "../../utils/util.ts";
import { v2 } from "../../utils/v2.ts";
import { Main, type PartialMapDef } from "./baseDefs.ts";

/**
 * AI Combat Lab: Crossfire
 *
 * A symmetric AI-only evaluation arena. It deliberately combines five tactical
 * problems in one compact map: a long centre lane, protected side rotations,
 * destructible breach cover, reflective stone angles and grenade pockets.
 */
const mapDef: PartialMapDef = {
    mapId: GameConfig.MapId.DuelAi,
    desc: {
        name: "AI Combat Lab: Crossfire",
        icon: "/img/gui/duel-arena-emblem.png",
        buttonCss: "btn-mode-duel",
        buttonText: "AI Lab",
    },
    biome: {
        colors: {
            background: 0x111820,
            water: 0x18344f,
            waterRipple: 0x8ac6d1,
            beach: 0x9aa6a6,
            riverbank: 0x596a70,
            grass: 0x536f5a,
            underground: 0x1b2630,
            playerSubmerge: 0x18344f,
            playerGhillie: 0x536f5a,
        },
        valueAdjust: 0.93,
    },
    gameMode: {
        maxPlayers: 2,
        killLeaderEnabled: false,
    },
    gameConfig: { planes: { timings: [], crates: [] } },
    arena: {
        lockPlayersUntilFull: true,
        rounds: { total: 7, resetDelay: 1.6 },
        gas: { duration: 150, damage: 8 },
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
            size: 28,
            alpha: 0.72,
            leftColor: 0xd04a3a,
            rightColor: 0x3a78d0,
        },
        playerSpawns: [v2.create(0.12, 0.5), v2.create(0.88, 0.5)],
        objects: [
            // Spawn shields prevent a frame-one shot while leaving three exits.
            { type: "stone_01", pos: v2.create(0.19, 0.5), scale: 0.92 },
            { type: "stone_01", pos: v2.create(0.81, 0.5), scale: 0.92 },
            { type: "sandbags_01", pos: v2.create(0.205, 0.34), ori: 1 },
            { type: "sandbags_01", pos: v2.create(0.795, 0.66), ori: 1 },
            { type: "sandbags_01", pos: v2.create(0.205, 0.66), ori: 1 },
            { type: "sandbags_01", pos: v2.create(0.795, 0.34), ori: 1 },

            // Centre breach lane: paired crates open progressively under fire.
            { type: "crate_01", pos: v2.create(0.34, 0.5), ori: 0 },
            { type: "crate_01", pos: v2.create(0.42, 0.5), ori: 0 },
            { type: "crate_01", pos: v2.create(0.58, 0.5), ori: 0 },
            { type: "crate_01", pos: v2.create(0.66, 0.5), ori: 0 },

            // Reflective diamond: stones create calculable one-bounce paths into
            // the two central healing pockets without sealing the centre.
            { type: "stone_01", pos: v2.create(0.5, 0.34), scale: 1.05 },
            { type: "stone_01", pos: v2.create(0.5, 0.66), scale: 1.05 },
            { type: "stone_01", pos: v2.create(0.43, 0.42), scale: 0.72 },
            { type: "stone_01", pos: v2.create(0.57, 0.58), scale: 0.72 },
            { type: "stone_01", pos: v2.create(0.43, 0.58), scale: 0.72 },
            { type: "stone_01", pos: v2.create(0.57, 0.42), scale: 0.72 },

            // North route: alternating hard and destructible cover rewards
            // prediction instead of a single permanently safe shoulder peek.
            { type: "sandbags_01", pos: v2.create(0.31, 0.24), ori: 0 },
            { type: "sandbags_01", pos: v2.create(0.69, 0.24), ori: 0 },
            { type: "crate_01", pos: v2.create(0.405, 0.22), ori: 0 },
            { type: "crate_01", pos: v2.create(0.595, 0.22), ori: 0 },
            { type: "barrel_01", pos: v2.create(0.47, 0.19) },
            { type: "barrel_01", pos: v2.create(0.53, 0.19) },

            // South route mirrors north.
            { type: "sandbags_01", pos: v2.create(0.31, 0.76), ori: 0 },
            { type: "sandbags_01", pos: v2.create(0.69, 0.76), ori: 0 },
            { type: "crate_01", pos: v2.create(0.405, 0.78), ori: 0 },
            { type: "crate_01", pos: v2.create(0.595, 0.78), ori: 0 },
            { type: "barrel_01", pos: v2.create(0.47, 0.81) },
            { type: "barrel_01", pos: v2.create(0.53, 0.81) },

            // Grenade pockets near each side are safe from direct centre fire but
            // have two exits and multiple bank-shot surfaces, preventing camping.
            { type: "sandbags_01", pos: v2.create(0.28, 0.39), ori: 0 },
            { type: "sandbags_01", pos: v2.create(0.72, 0.61), ori: 0 },
            { type: "sandbags_01", pos: v2.create(0.28, 0.61), ori: 0 },
            { type: "sandbags_01", pos: v2.create(0.72, 0.39), ori: 0 },

            // Outer rotation anchors stop edge running from becoming completely
            // exposed while remaining too small to support permanent healing.
            { type: "stone_01", pos: v2.create(0.14, 0.18), scale: 0.66 },
            { type: "stone_01", pos: v2.create(0.86, 0.18), scale: 0.66 },
            { type: "stone_01", pos: v2.create(0.14, 0.82), scale: 0.66 },
            { type: "stone_01", pos: v2.create(0.86, 0.82), scale: 0.66 },
        ],
        loot: [],
    },
    /* STRIP_FROM_PROD_CLIENT:START */
    mapGen: {
        map: {
            baseWidth: 188,
            baseHeight: 152,
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
        places: [{ name: "AI Combat Lab", pos: v2.create(0.5, 0.5) }],
        bridgeTypes: { medium: "", large: "", xlarge: "" },
        customSpawnRules: { locationSpawns: [], placeSpawns: [] },
        densitySpawns: [{}],
        fixedSpawns: [{}],
        randomSpawns: [{ spawns: [], choose: 0 }],
        spawnReplacements: [{}],
        importantSpawns: [],
    },
    /* STRIP_FROM_PROD_CLIENT:END */
};

export const DuelAi = util.mergeDeep({}, Main, mapDef);
