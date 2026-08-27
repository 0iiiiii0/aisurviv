import { GameConfig } from "../../gameConfig.ts";
import type { MapDef } from "../mapDefs.ts";
import { Extraction } from "./extractionDefs.ts";

/**
 * 绝密搜打撤 (secret extraction): uses the exact same map and loot rules as
 * the normal extraction playlist, but as a *distinct* map / playlist so that
 * normal and secret extraction rooms can run simultaneously. The room-level
 * secret flag (extractionSecretMode) drives last-man AI, the 5-minute
 * extraction lockout, the 2-minute join window and the boosted secret drops.
 */
export const ExtractionSecret: MapDef = {
    ...Extraction,
    mapId: GameConfig.MapId.ExtractionSecret,
    desc: {
        ...Extraction.desc,
        name: "绝密搜打撤",
        buttonCss: "mode-button-extraction",
    },
    gameMode: {
        ...Extraction.gameMode,
        extractionSecretMode: true,
    },
    // 绝密空投：在基础 01/02 空投之外加入金空投（airdrop_crate_03），
    // 使其携带 tier_airdrop_golden_shotguns（super90=m1014 / usas12=usas）。
    gameConfig: {
        ...Extraction.gameConfig,
        planes: {
            ...(Extraction.gameConfig?.planes ?? { timings: [], crates: [] }),
            crates: [
                { name: "airdrop_crate_01", weight: 10 },
                { name: "airdrop_crate_02", weight: 1 },
                { name: "airdrop_crate_03", weight: 1 },
            ],
        },
    },
};
