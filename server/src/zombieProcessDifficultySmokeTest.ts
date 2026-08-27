import assert from "node:assert/strict";
import { TeamMode } from "../../shared/gameConfig.ts";
import {
    createProcessMatchmakingGameConfig,
    processRoomMatchesZombieDifficulty,
} from "./game/gameProcessManager.ts";

const zombieMode = { mapName: "zombie" as const, teamMode: TeamMode.Solo };

const hardConfig = createProcessMatchmakingGameConfig(zombieMode, "hard");
assert.equal(
    hardConfig.zombieDifficulty,
    "hard",
    "production worker room must preserve requested hard difficulty",
);

const simpleConfig = createProcessMatchmakingGameConfig(zombieMode, "simple");
assert.equal(simpleConfig.zombieDifficulty, "simple");

assert.equal(
    processRoomMatchesZombieDifficulty("zombie", "normal", "hard"),
    false,
    "hard matchmaking must not reuse an existing normal zombie room",
);
assert.equal(
    processRoomMatchesZombieDifficulty("zombie", "hard", "hard"),
    true,
    "hard matchmaking may reuse an existing hard zombie room",
);
assert.equal(
    processRoomMatchesZombieDifficulty("zombie", undefined, undefined),
    true,
    "legacy/unspecified zombie rooms default to normal",
);
assert.equal(
    processRoomMatchesZombieDifficulty("main", "normal", "hard"),
    true,
    "non-zombie playlists ignore zombie difficulty metadata",
);

console.log(
    "✓ production zombie matchmaking preserves hard difficulty and isolates simple/normal/hard rooms",
);
