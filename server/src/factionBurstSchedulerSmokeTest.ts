import assert from "node:assert/strict";
import { TeamMode } from "../../shared/gameConfig.ts";
import { Config } from "./config.ts";
import { GameServer } from "./gameServer.ts";

const previous = {
    enabled: Config.botAutoFill.enabled,
    requireHuman: Config.botAutoFill.requireHumanBeforeFill,
    factionTarget: Config.botAutoFill.factionTargetPlayerCount,
    factionLimit: Config.roomPlayerLimits.faction,
    maxWorkers: Config.botAutoFill.maxBotWorkers,
};

try {
    Config.botAutoFill.enabled = true;
    Config.botAutoFill.requireHumanBeforeFill = true;
    Config.botAutoFill.factionTargetPlayerCount = 40;
    Config.roomPlayerLimits.faction = 40;
    Config.botAutoFill.maxBotWorkers = 16;

    const tokenSizes: number[] = [];
    const spawned: Array<{ botCount: number; botTeamIds: number[] }> = [];
    const server = Object.create(GameServer.prototype) as GameServer;
    Object.assign(server as unknown as Record<string, unknown>, {
        autoFillRunning: false,
        remoteFactionReconcileRunning: false,
        nextRemoteFactionReconcileAt: 0,
        botProcesses: new Map(),
        remoteFactionBotJobs: new Map(),
        pendingBotCount: new Map(),
        duelBotClaims: new Set(),
        nextBotOrdinalByGame: new Map(),
        logger: { warn: () => {}, info: () => {} },
        manager: {
            listGames: () => [{
                id: "faction-burst-room",
                stopped: false,
                privateGame: false,
                canJoin: true,
                mapName: "faction",
                teamMode: TeamMode.Squad,
                humanPlayerCount: 1,
                reservedHumanCount: 0,
                serverBotCount: 0,
                serverBotTeamCounts: [0, 0],
            }],
            createJoinToken: async (
                gameId: string,
                _ttl: number,
                _spectator: boolean,
                count: number,
            ) => {
                tokenSizes.push(count);
                return { gameId, data: `burst-token-${tokenSizes.length}` };
            },
        },
        spawnGameBot: (options: { botCount: number; botTeamIds: number[] }) => {
            spawned.push({
                botCount: options.botCount,
                botTeamIds: [...options.botTeamIds],
            });
            return true;
        },
    });

    await (server as unknown as { runBotAutoFillTick(): Promise<void> }).runBotAutoFillTick();
    assert.deepEqual(tokenSizes, [8, 8, 8, 8, 7]);
    assert.deepEqual(spawned.map((entry) => entry.botCount), tokenSizes);
    assert.equal(spawned.flatMap((entry) => entry.botTeamIds).length, 39);
    const teams = spawned.flatMap((entry) => entry.botTeamIds);
    assert.ok(Math.abs(teams.filter((team) => team === 1).length - teams.filter((team) => team === 2).length) <= 1);
} finally {
    Config.botAutoFill.enabled = previous.enabled;
    Config.botAutoFill.requireHumanBeforeFill = previous.requireHuman;
    Config.botAutoFill.factionTargetPlayerCount = previous.factionTarget;
    Config.roomPlayerLimits.faction = previous.factionLimit;
    Config.botAutoFill.maxBotWorkers = previous.maxWorkers;
}

console.log("50v50 burst scheduler smoke test passed: 39 bots dispatch as 8+8+8+8+7 in one tick.");
