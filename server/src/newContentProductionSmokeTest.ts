import assert from "assert/strict";
import fs from "fs";
import path from "path";
import { RawGameObjectDefs as GameObjectDefs } from "../../shared/defs/gameObjectDefs.ts";
import { GunDefs } from "../../shared/defs/gameObjects/gunDefs.ts";
import { MeleeDefs } from "../../shared/defs/gameObjects/meleeDefs.ts";
import { PerkDefs } from "../../shared/defs/gameObjects/perkDefs.ts";
import { RoleDefs } from "../../shared/defs/gameObjects/roleDefs.ts";
import { MapDefs } from "../../shared/defs/mapDefs.ts";
import { RawMapObjectDefs as MapObjectDefs } from "../../shared/defs/mapObjectDefs.ts";

type LootEntry = { name: string; count?: number; weight: number };

const newWeaponNames = {
    imbel: "IMD-2",
    spas16: "SPAS-16",
    ash12: "ASh-12",
    barrett: "Barrett M107",
    sw500: "S&W 500",
    potato_lmg: "PMG-134",
} as const;

function tierContains(mapName: keyof typeof MapDefs, tier: string, itemName: string): boolean {
    const entries = MapDefs[mapName].lootTable[tier] as LootEntry[] | undefined;
    return Boolean(entries?.some((entry) => entry.name === itemName && entry.weight > 0));
}

function obstacleUsesTier(tier: string): boolean {
    return Object.values(MapObjectDefs).some((rawDef) => {
        const def = rawDef as { loot?: Array<{ tier?: string }> };
        return def.loot?.some((entry) => entry.tier === tier);
    });
}

function obstacleDropsItem(itemName: string): boolean {
    return Object.values(MapObjectDefs).some((rawDef) => {
        const def = rawDef as { loot?: Array<{ type?: string }> };
        return def.loot?.some((entry) => entry.type === itemName);
    });
}

// Each new gun must be a complete loot object and have at least one real,
// positive-weight production route in the mode that introduced it.
for (const [type, displayName] of Object.entries(newWeaponNames)) {
    const def = GunDefs[type];
    assert.ok(def, `${type} gun definition exists`);
    assert.equal(def.name, displayName, `${type} keeps its upstream display name`);
    assert.ok("lootImg" in GameObjectDefs[type], `${type} can be spawned as loot`);
    assert.ok(GameObjectDefs[def.bulletType], `${type} references a valid bullet definition`);
}

assert.ok(tierContains("main", "tier_guns_common_tank", "imbel"));
assert.ok(tierContains("main", "tier_guns_rare_demo", "spas16"));
for (const type of ["ash12", "barrett", "sw500"]) {
    assert.ok(tierContains("main", "tier_airdrop_crimson", type), `${type} is in the crimson drop pool`);
}
assert.ok(tierContains("potato", "tier_airdrop_potato", "potato_lmg"));
assert.ok(obstacleUsesTier("tier_airdrop_crimson"), "a breakable object produces the crimson gun pool");
assert.ok(obstacleDropsItem("spas16"), "SPAS-16 also has a fixed gun-mount spawn");

const newPerks = [
    "assume_leadership",
    "ap_rounds",
    "lifeline",
    "combat_stims",
    "pirate",
    "amped_explosives",
    "high_velocity",
] as const;
for (const type of newPerks) {
    assert.ok(PerkDefs[type], `${type} perk definition exists`);
    assert.ok("lootImg" in GameObjectDefs[type], `${type} can be represented by the loot system`);
}

assert.ok(tierContains("main", "tier_crimson_perks", "ap_rounds"));
assert.ok(tierContains("main", "tier_class_crate_mythic", "lifeline"));
assert.ok(tierContains("main", "tier_perks", "high_velocity"));
assert.ok(tierContains("desert", "tier_perks", "amped_explosives"));
assert.ok(obstacleUsesTier("tier_crimson_perks"));
assert.ok(obstacleUsesTier("tier_class_crate_mythic"));
assert.ok(obstacleUsesTier("tier_perks"));
assert.ok(RoleDefs.captain.perks?.includes("assume_leadership"), "captain promotion grants Assume Leadership");
assert.ok(RoleDefs.healer.perks?.includes("combat_stims"), "Cobalt medic grants Combat Stimulants");
assert.equal(MeleeDefs.cutlass_gold.perk, "pirate", "Gold Cutlass grants Pirate's Bounty");
assert.ok(obstacleDropsItem("cutlass_gold"), "Gold Cutlass has a fixed gun-mount spawn");

const rootDir = path.join(import.meta.dirname, "..", "..");
const en = JSON.parse(fs.readFileSync(path.join(rootDir, "client/src/en.json"), "utf8")) as Record<string, string>;
const zh = JSON.parse(fs.readFileSync(path.join(rootDir, "client/public/l10n/zh-cn.json"), "utf8")) as Record<string, string>;
for (const [type, displayName] of Object.entries(newWeaponNames)) {
    assert.equal(en[`game-${type}`], displayName, `${type} English display name is synchronized`);
    assert.equal(zh[`game-${type}`], displayName, `${type} Chinese display name is synchronized`);
}

for (const localePath of ["client/src/en.json", "client/public/l10n/zh-cn.json"]) {
    const source = fs.readFileSync(path.join(rootDir, localePath), "utf8");
    for (const type of [...Object.keys(newWeaponNames), ...newPerks]) {
        const matches = source.match(new RegExp(`^\\s*"game-${type}"\\s*:`, "gm")) ?? [];
        assert.equal(matches.length, 1, `${localePath} contains exactly one game-${type} name`);
    }
}

console.log("New content production smoke test passed: 6 guns, 7 perks and synchronized weapon names.");
