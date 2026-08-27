import assert from "assert/strict";
import { RawGameObjectDefs as GameObjectDefs } from "../../shared/defs/gameObjectDefs.ts";
import { MapDefs } from "../../shared/defs/mapDefs.ts";

const expected: Record<string, number> = {
    desert: 0xdfa761,
    snow: 0xbbbbbb,
    woods_snow: 0xbbbbbb,
    woods_spring: 0x41630a,
};

for (const [mapName, color] of Object.entries(expected)) {
    assert.equal(
        MapDefs[mapName as keyof typeof MapDefs].biome.colors.playerGhillie,
        color,
        `${mapName} must use its environment-specific ghillie tint`,
    );
}

assert(GameObjectDefs.outfitGhillie, "the shared dynamic ghillie outfit must exist");
for (const [mapName, mapDef] of Object.entries(MapDefs)) {
    const color = Number(mapDef.biome.colors.playerGhillie);
    assert(Number.isInteger(color) && color >= 0 && color <= 0xffffff, `${mapName} has invalid ghillie tint`);
    for (const [tierName, entries] of Object.entries(mapDef.lootTable ?? {}) as Array<
        [string, Array<{ name?: string }>]
    >) {
        for (const entry of entries) {
            const item = String(entry.name ?? "");
            if (!/^outfit.*Ghillie$/i.test(item)) continue;
            assert.equal(
                item,
                "outfitGhillie",
                `${mapName}:${tierName} must use the defined dynamic outfitGhillie type`,
            );
        }
    }
}

console.log("Ghillie config smoke test passed: environment tints and loot references are valid.");
