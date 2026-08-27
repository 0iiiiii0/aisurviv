import assert from "node:assert/strict";
import { TeamMode } from "../../shared/gameConfig.ts";
import { RawMapObjectDefs } from "../../shared/defs/mapObjectDefs.ts";
import { Extraction } from "../../shared/defs/maps/extractionDefs.ts";
import { Main } from "../../shared/defs/maps/baseDefs.ts";
import { Beach } from "../../shared/defs/maps/beachDefs.ts";
import { Game } from "./game/game.ts";
import { ObjectType } from "../../shared/net/objectSerializeFns.ts";

/**
 * 搜打撤椰子掉落：新增 tree_14e 椰子树（较 Beach 降低数量与概率）。
 * - 地图生成约 14+ 棵 tree_14e（Beach 为 35 棵 tree_14）；
 * - 每棵摧毁只掉 1 个椰子（Beach tree_14 掉 3 个）；
 * - 投掷物地面表 coconut×1 权重 0.15（Beach ×3 / 0.4）；
 * - 皮肤表 1/40（基础 1/20 减半）；
 * - Main / Beach 等其他地图的表不受影响。
 */

type LootEntry = { name: string; count: number; weight: number };
type MapWithLoot = { lootTable: Record<string, LootEntry[]>; mapGen: { densitySpawns: Array<Record<string, number>> } };

// 1) 定义层：搜打撤表正确、其他地图不受影响。
const extraction = Extraction as unknown as MapWithLoot;
const extractionThrowables = extraction.lootTable.tier_throwables;
assert.deepEqual(
    extractionThrowables.find((entry) => entry.name === "coconut"),
    { name: "coconut", count: 1, weight: 0.15 },
    "extraction throwable tier must contain a reduced coconut entry",
);
assert.equal(
    extractionThrowables.filter((entry) => entry.name === "frag" || entry.name === "smoke" || entry.name === "mirv").length,
    3,
    "existing throwable entries must be preserved",
);
const extractionOutfitTier = extraction.lootTable.tier_coconut_outfit;
assert.equal(
    extractionOutfitTier.find((entry) => entry.name === "outfitCoconut")?.weight,
    1,
    "extraction coconut outfit chance weight",
);
assert.equal(
    extractionOutfitTier.find((entry) => entry.name === "")?.weight,
    39,
    "extraction coconut outfit empty weight (1/40, half of base 1/20)",
);
assert.equal(
    extraction.mapGen.densitySpawns[0].tree_14e,
    14,
    "extraction map must spawn tree_14e palms via density spawns",
);

const main = Main as unknown as MapWithLoot;
const mainDensity = main.mapGen.densitySpawns[0];
for (const [type, count] of Object.entries(mainDensity)) {
    assert.equal(
        extraction.mapGen.densitySpawns[0][type],
        count,
        `extraction must preserve the base density spawn for ${type}`,
    );
}
assert.equal(
    Object.values(extraction.mapGen.densitySpawns[0]).reduce((sum, count) => sum + count, 0),
    Object.values(mainDensity).reduce((sum, count) => sum + count, 0) + 14,
    "extraction density must contain the complete base map plus 14 reduced-yield palms",
);

const mainLoot = main.lootTable;
assert.equal(
    mainLoot.tier_throwables.some((entry) => entry.name === "coconut"),
    false,
    "base map throwable tier must stay coconut-free",
);
assert.deepEqual(
    (Beach as unknown as MapWithLoot).lootTable.tier_throwables.find((entry) => entry.name === "coconut"),
    { name: "coconut", count: 3, weight: 0.4 },
    "beach coconut rates must stay untouched",
);

// 2) 椰子树定义：tree_14e 摧毁掉 1 个椰子（tree_14 仍是 3 个）。
const palmDef = RawMapObjectDefs.tree_14e as unknown as {
    loot: Array<{ type?: string; tier?: string; count?: number }>;
};
assert.ok(palmDef, "tree_14e must exist in shared map object defs");
assert.equal(
    palmDef.loot.filter((entry) => entry.type === "coconut").reduce((sum, entry) => sum + (entry.count ?? 0), 0),
    1,
    "tree_14e drops exactly 1 coconut per tree",
);
const beachPalmDef = RawMapObjectDefs.tree_14 as unknown as {
    loot: Array<{ type?: string; count?: number }>;
};
assert.equal(
    beachPalmDef.loot.filter((entry) => entry.type === "coconut").reduce((sum, entry) => sum + (entry.count ?? 0), 0),
    3,
    "beach tree_14 keeps its 3-coconut drop",
);

// 3) 真实对局：地图生成 tree_14e，摧毁恰好掉 1 个椰子。
const game = new Game("extraction-coconut-live", {
    mapName: "extraction",
    teamMode: TeamMode.Solo,
});
const obstacles = game.objectRegister.objects.filter(
    (o): o is NonNullable<typeof o> => o !== undefined && o.__type === ObjectType.Obstacle,
) as unknown as Array<{ type: string; kill: (params: { source?: undefined }) => void }>;
const palms = obstacles.filter((o) => o.type === "tree_14e");
assert.ok(palms.length >= 10, `extraction map must generate tree_14e palms, got ${palms.length}`);
assert.equal(
    obstacles.some((o) => o.type === "tree_14"),
    false,
    "full-yield beach palms (tree_14) must not spawn on extraction",
);
const before = game.lootBarn.loots.length;
palms[0]!.kill({ source: undefined });
const dropped = game.lootBarn.loots.slice(before).filter((loot) => loot.type === "coconut");
assert.equal(
    dropped.length,
    1,
    `destroying a tree_14e must drop exactly 1 coconut, got ${dropped.length}`,
);
game.stop();

console.log(
    "Extraction coconut smoke test passed: reduced-rate palms (14+ per map, 1 coconut each, 1/40 outfit) spawn only on extraction; beach/base tables untouched.",
);
