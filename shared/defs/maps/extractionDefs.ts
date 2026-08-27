import { GameConfig } from "../../gameConfig.ts";
import { util } from "../../utils/util.ts";
import type { MapDef } from "../mapDefs.ts";
import { Main, type PartialMapDef } from "./baseDefs.ts";

/**
 * 搜打撤 (search-fight-extract) mode: the classic Normal map with the
 * extraction gameMode flag. Every contestant can bring gear from their stash,
 * loot the map, then leave through the active extraction point (the one
 * farthest from the player) to bank their loot.
 *
 * 必须用 mergeDeep（与 beachDefs 一致）：lootTable/mapGen 是对 Main 的
 * **局部覆盖**，浅展开（{...Main, lootTable}）会把 Main 的其余战利品层
 * （tier_guns 等）整体丢掉。
 */
const mapDef: PartialMapDef = {
    mapId: GameConfig.MapId.Extraction,
    desc: {
        name: "搜打撤",
        icon: "",
        buttonCss: "mode-button-extraction",
    },
    gameMode: {
        extractionMode: true,
    },
    /* STRIP_FROM_PROD_CLIENT:START */
    // 搜打撤椰子（较 Beach 降低数量与概率）：
    // - 地面投掷物表：coconut×1 权重 0.15（Beach 为 ×3 / 0.4）；
    // - 椰子树皮肤表：1/40（基础表 1/20 减半）；
    // - 地图密度生成 tree_14e 椰子树 14 棵（Beach 为 35 棵，且每棵只掉
    //   1 个椰子而非 3 个）。tree_14e 仅在搜打撤生成，不影响其他地图。
    lootTable: {
        tier_throwables: [
            { name: "frag", count: 2, weight: 1 },
            { name: "smoke", count: 1, weight: 1 },
            { name: "mirv", count: 2, weight: 0.05 },
            { name: "coconut", count: 1, weight: 0.15 },
        ],
        tier_coconut_outfit: [
            { name: "", count: 1, weight: 39 },
            { name: "outfitCoconut", count: 1, weight: 1 },
        ],
    },
    mapGen: {
        densitySpawns: [
            {
                // mergeDeep replaces arrays rather than merging their
                // elements. Carry the complete Normal density table forward
                // so adding extraction palms does not erase the map's trees,
                // rocks, crates, bushes and loose loot.
                ...Main.mapGen.densitySpawns[0],
                tree_14e: 14,
            },
        ],
    },
    /* STRIP_FROM_PROD_CLIENT:END */
};

export const Extraction = util.mergeDeep({}, Main, mapDef) as MapDef;
