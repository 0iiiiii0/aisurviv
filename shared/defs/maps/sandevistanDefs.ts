import { GameConfig } from "../../gameConfig.ts";
import type { MapDef } from "../mapDefs.ts";
import { Main } from "./baseDefs.ts";

/**
 * Sandevistan mode reuses the classic Normal (main) map: identical terrain,
 * loot tables and buildings. gameMode.sandevistanMode flips the dedicated mode
 * so every contestant owns the implant and the server runs global time
 * dilation while the (single) human activates it.
 */
export const Sandevistan: MapDef = {
    ...Main,
    mapId: GameConfig.MapId.Sandevistan,
    desc: {
        ...Main.desc,
        name: "斯安威斯坦",
        icon: "",
        buttonCss: "mode-button-sandevistan",
    },
    gameMode: {
        ...Main.gameMode,
        sandevistanMode: true,
    },
};
