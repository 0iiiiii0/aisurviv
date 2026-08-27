import { performance } from "node:perf_hooks";
import { TeamMode } from "../../shared/gameConfig.ts";
import { generateTerrain } from "../../shared/utils/terrainGen.ts";
import { Game } from "./game/game.ts";

async function main() {
    for (const mapName of ["main", "faction", "potato", "woods"]) {
        const game = new Game("bench-" + mapName, { mapName, teamMode: TeamMode.Solo }, () => {}, () => {});
        const map = game.map;
        let t = performance.now();
        map.generateTerrain();
        map.terrain = generateTerrain(map.width, map.height, map.shoreInset, map.grassInset, map.riverDescs, map.seed);
        const tTerrain = performance.now() - t;
        t = performance.now();
        map.generateObjects();
        const tObjects = performance.now() - t;
        t = performance.now();
        map.mapStream.serializeMsg(1, map.msg);
        const tSerialize = performance.now() - t;
        console.log(
            mapName,
            "terrain",
            tTerrain.toFixed(1),
            "objects",
            tObjects.toFixed(1),
            "serialize",
            tSerialize.toFixed(1),
            "total",
            (tTerrain + tObjects + tSerialize).toFixed(1),
        );
    }
}
void main();
