import assert from "node:assert/strict";
import { TeamMode } from "../../shared/gameConfig.ts";
import { GameServer } from "./gameServer.ts";
import { SpectatorShareService } from "./spectatorShare.ts";
import type { GameData, ServerGameConfig } from "./game/gameManager.ts";
import type { AdminPureAiDuelRequest } from "./adminServer.ts";

async function run(): Promise<void> {
const gameId = "b".repeat(40);
const game: GameData = {
    id: gameId,
    teamMode: TeamMode.Solo,
    mapName: "duel_ai",
    canJoin: true,
    aliveCount: 0,
    connectedCount: 0,
    humanPlayerCount: 0,
    aiPlayerCount: 0,
    spectatorCount: 0,
    serverBotCount: 0,
    serverBotTeamCounts: [],
    reservedHumanCount: 0,
    startedTime: 0,
    stopped: false,
    privateGame: true,
};
let createdConfig: ServerGameConfig | undefined;
const tokenCalls: Array<{ spectator: boolean; serverBot: boolean; index?: number }> = [];
const manager = {
    async createGame(config: ServerGameConfig) {
        createdConfig = config;
        return game;
    },
    async createJoinToken(
        id: string,
        _ttl: number,
        spectator = false,
        _count = 1,
        _autoFill = false,
        serverBot = false,
        _teams?: readonly number[],
        index?: number,
    ) {
        tokenCalls.push({ spectator, serverBot, index });
        return { gameId: id, data: `${spectator ? "observer" : "bot"}-${index ?? 0}` };
    },
    getById(id: string) { return id === gameId ? game : undefined; },
    stopGame(id: string) { if (id !== gameId) return false; game.stopped = true; return true; },
    listGames() { return [game]; },
};
const server = Object.create(GameServer.prototype) as GameServer;
(server as any).manager = manager;
(server as any).region = { https: false, address: "127.0.0.1:8001" };
(server as any).duelBotClaims = new Set<string>();
(server as any).spectatorShares = new SpectatorShareService((id) => manager.getById(id));
(server as any).spawnGameBot = () => {
    game.aiPlayerCount += 1;
    game.serverBotCount += 1;
    game.connectedCount += 1;
    game.aliveCount += 1;
};
const request: AdminPureAiDuelRequest = {
    difficulties: ["pro", "hard"],
    contestantLoadouts: [
        { weapons: ["ak47", "mosin"] },
        { weapons: ["m39", "mp220"] },
    ],
    loadout: {
        weapons: ["ak47", "mosin"],
        weaponSelectionMode: "individual",
        adrenalineEnabled: true,
        boost: 100,
        helmetLevel: 2,
        chestLevel: 2,
        scope: "4xscope",
        throwables: { frag: 1, mirv: 0, smoke: 0, strobe: 0, snowball: 0, potato: 0 },
        aiEnabled: true,
        aiDifficulty: "hard",
    },
};
const result = await (server as any).createPureAiDuel(request);
assert.equal(result.gameId, gameId);
assert.match(result.spectatorShareCode, /^[A-HJ-NP-Z2-9]{8}$/);
assert.equal(result.matchData.gameId, gameId);
assert.equal(createdConfig?.pureAiMatch, true);
assert.equal(createdConfig?.mapName, "duel_ai");
assert.deepEqual(createdConfig?.duelPlayerLoadouts, request.contestantLoadouts);
assert.deepEqual(tokenCalls, [
    { spectator: false, serverBot: true, index: 0 },
    { spectator: false, serverBot: true, index: 1 },
    { spectator: true, serverBot: false, index: undefined },
]);
assert.equal(game.aiPlayerCount, 2);
assert.equal(game.serverBotCount, 2);

    console.log("V41 pure-AI duel smoke test passed: two independently configured bots and a current-match spectator credential are created.");

}

void run();
