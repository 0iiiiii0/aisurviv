import assert from "assert";
import fs from "fs";
import path from "path";
import type { TeamMode } from "../../shared/gameConfig.ts";
import {
    isAdminVisibleGame,
    isGameSpectatable,
    type GameData,
} from "./game/gameManager.ts";

const room = (overrides: Partial<GameData> = {}): GameData => ({
    id: "8c14af96" + "0".repeat(28) + "a737",
    teamMode: 4 as TeamMode,
    mapName: "faction",
    canJoin: false,
    aliveCount: 1,
    connectedCount: 1,
    humanPlayerCount: 1,
    aiPlayerCount: 0,
    spectatorCount: 0,
    serverBotCount: 0,
    serverBotTeamCounts: [],
    reservedHumanCount: 0,
    startedTime: 463,
    stopped: false,
    over: false,
    privateGame: false,
    processHealth: "healthy",
    ...overrides,
});

assert.equal(isAdminVisibleGame(room()), true);
assert.equal(isGameSpectatable(room()), true);
assert.equal(
    isAdminVisibleGame(room({ over: true })),
    false,
    "the screenshot's alive=1 winner window must not remain on the dashboard",
);
assert.equal(isGameSpectatable(room({ over: true })), false);
assert.equal(isAdminVisibleGame(room({ stopped: true })), false);
assert.equal(isAdminVisibleGame(room({ processHealth: "warning" })), false);
assert.equal(isAdminVisibleGame(room({ processHealth: "fault" })), false);
assert.equal(isGameSpectatable(room({ aliveCount: 0 })), false);

const managerSource = fs.readFileSync(
    path.join(import.meta.dirname, "game/gameProcessManager.ts"),
    "utf8",
);
assert.match(managerSource, /this\.gameData\s*=\s*\{[\s\S]{0,180}\.\.\.update/);
assert(managerSource.includes("stale-room-snapshot-ignored"));
assert.match(
    managerSource,
    /Date\.now\(\) - proc\.lastMsgTime > 45_000[\s\S]{0,500}this\.killProcess\(proc, "SIGQUIT"\)/,
);

const workerSource = fs.readFileSync(path.join(import.meta.dirname, "game/gameProcess.ts"), "utf8");
assert.match(workerSource, /type: ProcessMsgType\.UpdateData,\s+id: this\.id/);

const adminSource = fs.readFileSync(path.join(import.meta.dirname, "adminServer.ts"), "utf8");
assert(adminSource.includes(".filter(isAdminVisibleGame)"));
assert(adminSource.includes("over: Boolean(game.over)"));

const gameServerSource = fs.readFileSync(path.join(import.meta.dirname, "gameServer.ts"), "utf8");
assert(gameServerSource.includes(".filter(isGameSpectatable)"));
assert.match(gameServerSource, /if \(!game \|\| !isGameSpectatable\(game\)\)/);

const spectateLobbySource = fs.readFileSync(
    path.join(import.meta.dirname, "../../client/src/ui/spectateLobby.ts"),
    "utf8",
);
assert.match(spectateLobbySource, /private loadingRooms = false;/);
assert.match(spectateLobbySource, /private joiningGame = false;/);
assert.doesNotMatch(
    spectateLobbySource,
    /private pending = false;/,
    "room polling and joining must not share a lock that silently drops watch clicks",
);
assert.match(
    spectateLobbySource,
    /private async watch[\s\S]*?if \(this\.joiningGame\) return;[\s\S]*?this\.joiningGame = true;/,
);

const adminClientSource = fs.readFileSync(
    path.join(import.meta.dirname, "../../client/public/admin/admin.js"),
    "utf8",
);
assert(adminClientSource.includes("spectateGame(game.id, spectate)"));
assert.match(
    adminClientSource,
    /The room may have ended[\s\S]{0,220}await refresh\(false\)/,
);

console.log("V58 admin ghost-room/spectate race smoke test passed");
