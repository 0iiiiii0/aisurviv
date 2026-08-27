import assert from "assert";

import { MapDefs } from "../../shared/defs/mapDefs.ts";
import { TeamMode } from "../../shared/gameConfig.ts";
import { Config } from "./config.ts";
import { ModeStrategy, resolveModeStrategy } from "./bot/modeStrategy.ts";

const expectedMaps = new Set(Object.keys(MapDefs).filter((mapName) => mapName !== "aim_training" && mapName !== "duel_ai"));
// Every public map contributes solo/duo/squad playlists; duel, faction and
// sandevistan only expose a single playlist (solo / squad / solo).
const singlePlaylistMaps = new Set(["duel", "faction", "sandevistan"]);
assert.equal(
    Config.modes.length,
    (expectedMaps.size - singlePlaylistMaps.size) * 3 + singlePlaylistMaps.size,
    "every public map must contribute its playlists to the catalogue",
);

for (const [index, mode] of Config.modes.entries()) {
    const profile = resolveModeStrategy(mode.mapName, mode.teamMode);
    assert.equal(profile.mapName, mode.mapName, `playlist ${index} map mismatch`);
    assert.equal(profile.teamMode, mode.teamMode, `playlist ${index} team mode mismatch`);
    assert.ok(profile.maxPlayers >= 2, `playlist ${index} invalid maxPlayers`);
    assert.ok(profile.specialTags.length >= 2, `playlist ${index} missing strategy tags`);
    expectedMaps.delete(mode.mapName);

    if (mode.mapName === "duel") {
        assert.equal(profile.kind, "duel");
        assert.equal(profile.lootEnabled, false);
        assert.equal(profile.crateLootEnabled, false);
        assert.equal(profile.reviveEnabled, false);
    } else if (mode.mapName === "faction") {
        assert.equal(profile.kind, "faction");
        assert.equal(profile.factionMode, true);
        assert.equal(profile.reviveEnabled, true);
    } else if (mode.teamMode === TeamMode.Solo) {
        assert.equal(profile.kind, "solo");
        assert.equal(profile.reviveEnabled, false);
    } else if (mode.teamMode === TeamMode.Duo) {
        assert.equal(profile.kind, "duo");
        assert.equal(profile.reviveEnabled, true);
    } else {
        assert.equal(profile.kind, "squad");
        assert.equal(profile.squadCoordination, true);
    }
}

assert.deepEqual([...expectedMaps], [], "every public map definition must appear in the playlist catalogue");

const strategy = new ModeStrategy();
assert.equal(strategy.load("potato", TeamMode.Solo).potatoMode, true);
assert.equal(strategy.load("cobalt", TeamMode.Squad).perkMode, true);
assert.equal(strategy.load("savannah", TeamMode.Solo).sniperMode, true);
assert.equal(strategy.load("woods_snow", TeamMode.Duo).woodsMode, true);
assert.equal(strategy.load("desert", TeamMode.Squad).desertMode, true);
assert.equal(strategy.load("turkey", TeamMode.Solo).turkeyMode, true);
assert.equal(strategy.load("unknown_custom", TeamMode.Duo).family, "custom");

assert.ok(
    strategy.load("savannah", TeamMode.Solo).combatScanMultiplier >
        strategy.load("woods", TeamMode.Solo).combatScanMultiplier,
    "open sniper maps should scan farther than Woods",
);
assert.ok(
    strategy.load("potato", TeamMode.Solo).lootRangeMultiplier > 1,
    "Potato mode should search more aggressively for weapon turnover",
);
assert.ok(
    strategy.load("faction", TeamMode.Squad).ammoReserveMultiplier > 1.2,
    "50v50 should retain larger ammunition reserves",
);

console.log("All-mode AI smoke test passed: 50 playlists / 18 maps / solo-duo-squad-faction-duel.");
