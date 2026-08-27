import { GameConfig } from "../../gameConfig.ts";
import { util } from "../../utils/util.ts";
import { v2 } from "../../utils/v2.ts";
import { Main, type PartialMapDef } from "./baseDefs.ts";

const mapDef: PartialMapDef = {
    mapId: GameConfig.MapId.AimTraining,
    desc: {
        name: "Aim Training Range",
        icon: "/img/gui/duel-arena-emblem.png",
        buttonCss: "btn-mode-aim-training",
        buttonText: "aim-training",
    },
    biome: {
        colors: {
            background: 0x111923,
            water: 0x1c3448,
            waterRipple: 0x8ac6d1,
            beach: 0x8d969f,
            riverbank: 0x566470,
            grass: 0x506b5d,
            underground: 0x17212b,
            playerSubmerge: 0x1c3448,
            playerGhillie: 0x506b5d,
        },
        valueAdjust: 0.94,
    },
    gameMode: {
        maxPlayers: 2,
        killLeaderEnabled: false,
    },
    gameConfig: {
        planes: { timings: [], crates: [] },
    },
    arena: {
        lockPlayersUntilFull: false,
        startingLoadout: {
            weapons: [{ type: "m4a1" }],
            activeWeaponSlot: 0,
            backpack: "backpack03",
            scope: "8xscope",
            boost: 0,
            perks: ["endless_ammo"],
            inventory: {
                bandage: 0,
                healthkit: 0,
                soda: 0,
                painkiller: 0,
                "1xscope": 1,
                "2xscope": 1,
                "4xscope": 1,
                "8xscope": 1,
                "15xscope": 1,
            },
        },
        emblem: {
            image: "/img/gui/duel-arena-emblem.png",
            size: 26,
            alpha: 0.7,
            leftColor: 0x59bde8,
            rightColor: 0xf19a57,
        },
        // Replaced per private match according to aimTrainingDistance.
        playerSpawns: [v2.create(0.18, 0.5), v2.create(0.62, 0.5)],
        objects: [
            // Backstop and range markers. The central lane remains completely open.
            { type: "sandbags_01", pos: v2.create(0.91, 0.5), ori: 1 },
            { type: "sandbags_01", pos: v2.create(0.91, 0.4), ori: 1 },
            { type: "sandbags_01", pos: v2.create(0.91, 0.6), ori: 1 },
            { type: "stone_01", pos: v2.create(0.32, 0.18), scale: 0.7 },
            { type: "stone_01", pos: v2.create(0.48, 0.18), scale: 0.7 },
            { type: "stone_01", pos: v2.create(0.64, 0.18), scale: 0.7 },
            { type: "stone_01", pos: v2.create(0.8, 0.18), scale: 0.7 },
            { type: "stone_01", pos: v2.create(0.32, 0.82), scale: 0.7 },
            { type: "stone_01", pos: v2.create(0.48, 0.82), scale: 0.7 },
            { type: "stone_01", pos: v2.create(0.64, 0.82), scale: 0.7 },
            { type: "stone_01", pos: v2.create(0.8, 0.82), scale: 0.7 },
        ],
        loot: [],
    },
    /* STRIP_FROM_PROD_CLIENT:START */
    mapGen: {
        map: {
            baseWidth: 220,
            baseHeight: 112,
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
        places: [{ name: "Aim Training Range", pos: v2.create(0.5, 0.5) }],
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

export const AimTraining = util.mergeDeep({}, Main, mapDef);
