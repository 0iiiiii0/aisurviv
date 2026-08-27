import assert from "node:assert/strict";
import { TeamMode } from "../../shared/gameConfig.ts";
import { GameServer } from "./gameServer.ts";
import type { GameData, ServerGameConfig } from "./game/gameManager.ts";

interface SpawnCall {
    gameId: string;
    difficulty: string;
    difficulties: string[];
    mapName: string;
    teamMode: TeamMode;
    botCount: number;
    botTeamIds: number[];
    joinDelayMs: number;
}

async function runSoloScenario(): Promise<void> {
    const gameId = "c".repeat(40);
    const game: GameData = {
        id: gameId, teamMode: TeamMode.Solo, mapName: "main", canJoin: true,
        aliveCount: 0, connectedCount: 0, humanPlayerCount: 0, aiPlayerCount: 0,
        spectatorCount: 0, serverBotCount: 0, serverBotTeamCounts: [],
        reservedHumanCount: 0, startedTime: 0, stopped: false, privateGame: true,
    };
    let createdConfig: ServerGameConfig | undefined;
    const spawnCalls: SpawnCall[] = [];
    const manager = {
        async createGame(config: ServerGameConfig) { createdConfig = config; return game; },
        async createJoinToken(
            id: string, _ttl: number, spectator = false, count = 1,
            _autoFill = false, serverBot = false, teams?: readonly number[],
        ) {
            return { gameId: id, data: `bot-token-${count}-${serverBot}-${JSON.stringify(teams ?? [])}` };
        },
        getById(id: string) {
            if (id !== gameId) return undefined;
            if (game.aiPlayerCount < 12) {
                game.aiPlayerCount = Math.min(12, game.aiPlayerCount + 8);
                game.serverBotCount = game.aiPlayerCount;
                game.connectedCount = game.aiPlayerCount;
                game.aliveCount = game.aiPlayerCount;
            }
            return game;
        },
        stopGame(id: string) { if (id !== gameId) return false; game.stopped = true; return true; },
        listGames() { return [game]; },
    };
    const server = Object.create(GameServer.prototype) as GameServer;
    (server as any).logger = { log: () => {}, warn: () => {} };
    (server as any).manager = manager;
    (server as any).duelBotClaims = new Set<string>();
    (server as any).spawnGameBot = (options: {
        gameId: string; difficulty: string; difficulties: string[]; mapName: string;
        teamMode: TeamMode; botCount: number; botTeamIds: number[]; joinDelayMs: number;
    }) => { spawnCalls.push(options); };

    const result = await (server as any).createAutoAiCapabilityMatch({
        mapName: "main", teamMode: TeamMode.Solo, botCount: 12,
    });
    assert.equal(result.gameId, gameId);
    assert.equal(result.botCount, 12);
    assert.equal(createdConfig?.mapName, "main");
    assert.equal(createdConfig?.teamMode, TeamMode.Solo);
    assert.equal(createdConfig?.privateGame, true);
    assert.equal(createdConfig?.pureAiMatch, true);

    assert.equal(spawnCalls.length, 2, "12 bots must be spawned in two 8+4 batches");
    assert.equal(spawnCalls[0].botCount, 8);
    assert.equal(spawnCalls[1].botCount, 4);
    assert.equal(spawnCalls[0].difficulties.length, 8);
    assert.equal(spawnCalls[1].difficulties.length, 4);
    assert.deepEqual(spawnCalls[0].botTeamIds, []);
    assert.equal(spawnCalls[0].mapName, "main");
    assert.equal(spawnCalls[0].teamMode, TeamMode.Solo);
}

async function runFactionScenario(): Promise<void> {
    const gameId = "d".repeat(40);
    const game: GameData = {
        id: gameId, teamMode: TeamMode.Squad, mapName: "faction", canJoin: true,
        aliveCount: 0, connectedCount: 0, humanPlayerCount: 0, aiPlayerCount: 0,
        spectatorCount: 0, serverBotCount: 0, serverBotTeamCounts: [0, 0],
        reservedHumanCount: 0, startedTime: 0, stopped: false, privateGame: true,
    };
    const spawnCalls: SpawnCall[] = [];
    const manager = {
        async createGame(config: ServerGameConfig) { return game; },
        async createJoinToken(
            id: string, _ttl: number, _spectator = false, count = 1,
            _autoFill = false, serverBot = false, teams?: readonly number[],
        ) {
            return { gameId: id, data: `faction-token-${serverBot}-${JSON.stringify(teams ?? [])}` };
        },
        getById(id: string) {
            if (id !== gameId) return undefined;
            if (game.aiPlayerCount < 10) {
                game.aiPlayerCount = Math.min(10, game.aiPlayerCount + 8);
                game.serverBotCount = game.aiPlayerCount;
                game.connectedCount = game.aiPlayerCount;
                game.aliveCount = game.aiPlayerCount;
                game.serverBotTeamCounts = [
                    Math.ceil(game.aiPlayerCount / 2),
                    Math.floor(game.aiPlayerCount / 2),
                ];
            }
            return game;
        },
        stopGame(id: string) { if (id !== gameId) return false; game.stopped = true; return true; },
        listGames() { return [game]; },
    };
    const server = Object.create(GameServer.prototype) as GameServer;
    (server as any).logger = { log: () => {}, warn: () => {} };
    (server as any).manager = manager;
    (server as any).duelBotClaims = new Set<string>();
    (server as any).spawnGameBot = (options: SpawnCall) => { spawnCalls.push(options); };

    const result = await (server as any).createAutoAiCapabilityMatch({
        mapName: "faction", teamMode: TeamMode.Squad, botCount: 10,
        difficulties: ["hard", "pro"],
    });
    assert.equal(result.botCount, 10);
    const allTeamIds = spawnCalls.flatMap((call) => call.botTeamIds);
    assert.deepEqual(allTeamIds, [1, 2, 1, 2, 1, 2, 1, 2, 1, 2]);
    const flatDifficulties = spawnCalls.flatMap((call) => call.difficulties);
    assert.deepEqual(flatDifficulties, ["hard", "pro", "hard", "pro", "hard", "pro", "hard", "pro", "hard", "pro"]);
}

async function runValidation(): Promise<void> {
    const server = Object.create(GameServer.prototype) as GameServer;
    (server as any).logger = { log: () => {}, warn: () => {} };
    (server as any).manager = {
        async createGame() { throw new Error("should not create"); },
        createJoinToken: async () => { throw new Error("should not join"); },
        getById: () => undefined,
        stopGame: () => false,
        listGames: () => [],
    };
    await assert.rejects(
        (server as any).createAutoAiCapabilityMatch({ mapName: "main", teamMode: TeamMode.Solo, botCount: 1 }),
        /botCount 需在 2-60/,
    );
    await assert.rejects(
        (server as any).createAutoAiCapabilityMatch({ mapName: "duel", teamMode: TeamMode.Solo, botCount: 8 }),
        /标准吃鸡地图/,
    );
    await assert.rejects(
        (server as any).createAutoAiCapabilityMatch({ mapName: "not_a_map", teamMode: TeamMode.Solo, botCount: 8 }),
        /找不到地图/,
    );
}

async function main(): Promise<void> {
    await runSoloScenario();
    await runFactionScenario();
    await runValidation();
    console.log("AI capability match smoke test passed: solo batching, faction team split, difficulty cycle, validation.");
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});
