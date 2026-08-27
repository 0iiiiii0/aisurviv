import assert from "node:assert/strict";
import { TeamMode } from "../../shared/gameConfig.ts";
import { Config } from "./config.ts";
import { isTeamModePlaylist } from "./teamPlaylistPolicy.ts";

const faction = Config.modes.find(
    (mode) => mode.mapName === "faction" && mode.teamMode === TeamMode.Squad,
);
assert.ok(faction, "50v50 faction playlist must exist");
assert.equal(
    isTeamModePlaylist(faction),
    true,
    "50v50 must remain selected when the all-modes entry creates an invite party",
);

const solo = Config.modes.find((mode) => mode.teamMode === TeamMode.Solo);
assert.ok(solo);
assert.equal(isTeamModePlaylist(solo), false, "solo playlists must still use quick play");

console.log("50v50 all-modes party routing smoke test passed");
