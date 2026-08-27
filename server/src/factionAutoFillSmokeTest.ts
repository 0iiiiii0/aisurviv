import assert from "assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import {
    getBotAutoFillPolicy,
    planFactionBotTeamIds,
    shouldAutoFillRoom,
} from "./botAutoFill.ts";
import { Config } from "./config.ts";
import { Game } from "./game/game.ts";

async function testForcedFactionToken(): Promise<void> {
    const game = new Game(
        "faction-autofill-forced-team",
        { mapName: "faction", teamMode: TeamMode.Squad },
        () => {},
        () => {},
    );
    game.gas.advanceGasStage();
    assert.equal(game.gas.duration, 125);

    const token = "forced-faction-bots";
    game.addJoinToken(token, true, 2, 60_000, false, true, [1, 2]);
    const addBot = (socketId: string, name: string) => {
        const join = new net.JoinMsg();
        join.protocol = GameConfig.protocolVersion;
        join.matchPriv = token;
        join.name = name;
        const player = game.playerBarn.addPlayer(socketId, join);
        assert(player);
        return player;
    };
    assert.equal(addBot("faction-bot-blue", "Blue Bot").teamId, 1);
    assert.equal(addBot("faction-bot-red", "Red Bot").teamId, 2);
    assert.deepEqual(game.serverBotTeamCounts, [1, 1]);
}

async function main(): Promise<void> {
    assert.equal(shouldAutoFillRoom({
        stopped: false,
        privateGame: true,
        alreadyCompleted: false,
        humanPlayerCount: 1,
        reservedHumanCount: 0,
    }), true);
    assert.equal(shouldAutoFillRoom({
        stopped: false,
        privateGame: false,
        alreadyCompleted: false,
        humanPlayerCount: 0,
        reservedHumanCount: 0,
    }), false);
    assert.equal(shouldAutoFillRoom({ stopped: true, privateGame: true, alreadyCompleted: false }), false);

    const previousSoloTarget = Config.botAutoFill.soloTargetPlayerCount;
    const previousDuoTarget = Config.botAutoFill.duoTargetPlayerCount;
    const previousSquadTarget = Config.botAutoFill.squadTargetPlayerCount;
    const previousFactionTarget = Config.botAutoFill.factionTargetPlayerCount;
    const previousFactionLimit = Config.roomPlayerLimits.faction;
    const previousDefaultJoin = Config.botAutoFill.defaultJoinIntervalMs;
    Config.botAutoFill.soloTargetPlayerCount = 80;
    Config.botAutoFill.defaultJoinIntervalMs = 2000;
    Config.botAutoFill.duoTargetPlayerCount = 80;
    Config.botAutoFill.squadTargetPlayerCount = 80;
    Config.botAutoFill.factionTargetPlayerCount = 60;
    // 房间上限临时放开，验证 50v50 的补齐目标确实取自它自己的后台设置，
    // 而不是被房间人数上限（当前默认 40）截断。
    Config.roomPlayerLimits.faction = 100;
    try {
        const policy = getBotAutoFillPolicy("faction", TeamMode.Squad);
        assert(policy);
        assert.equal(policy.factionMode, true);
        assert.equal(policy.targetPlayerCount, 60, "50v50 fill cap comes from its own admin setting");
        assert.equal(policy.processBatchSize, 60);
        assert.equal(policy.joinIntervalMs, 2000);

        // Fallback: an unset 50v50 cap follows the squad target.
        Config.botAutoFill.factionTargetPlayerCount = 0;
        assert.equal(
            getBotAutoFillPolicy("faction", TeamMode.Squad)?.targetPlayerCount,
            80,
        );
        Config.botAutoFill.factionTargetPlayerCount = 60;

        const plan = (overrides: Partial<Parameters<typeof planFactionBotTeamIds>[0]> = {}) =>
            planFactionBotTeamIds({
                connectedBotTeamCounts: [0, 0],
                pendingBotTeamCounts: [0, 0],
                connectedPlayerCount: 0,
                reservedHumanCount: 0,
                maxPlayers: 100,
                targetPlayerCount: 80,
                spawnPerSecond: 8,
                ...overrides,
            });

        assert.deepEqual(plan(), [1, 2, 1, 2, 1, 2, 1, 2]);
        assert.deepEqual(plan({
            connectedBotTeamCounts: [20, 20],
            connectedPlayerCount: 40,
        }), [1, 2, 1, 2, 1, 2, 1, 2], "obsolete 20+20 cap must not stop filling");
        assert.deepEqual(plan({
            connectedBotTeamCounts: [39, 38],
            connectedPlayerCount: 77,
            spawnPerSecond: 8,
        }), [2, 1, 2], "room must stop exactly at the shared target of 80");
        assert.deepEqual(plan({
            connectedBotTeamCounts: [39, 39],
            connectedPlayerCount: 78,
            reservedHumanCount: 2,
        }), [], "reserved humans count toward the shared target");
        assert.deepEqual(plan({
            connectedBotTeamCounts: [10, 10],
            pendingBotTeamCounts: [2, 1],
            connectedPlayerCount: 77,
        }), [], "pending bots count toward the shared target");
        assert.deepEqual(plan({
            connectedBotTeamCounts: [25, 20],
            connectedPlayerCount: 45,
            spawnPerSecond: 3,
        }), [2, 2, 2], "the smaller faction receives the next reservations");
    } finally {
        Config.botAutoFill.soloTargetPlayerCount = previousSoloTarget;
        Config.botAutoFill.duoTargetPlayerCount = previousDuoTarget;
        Config.botAutoFill.squadTargetPlayerCount = previousSquadTarget;
        Config.botAutoFill.factionTargetPlayerCount = previousFactionTarget;
        Config.roomPlayerLimits.faction = previousFactionLimit;
        Config.botAutoFill.defaultJoinIntervalMs = previousDefaultJoin;
    }

    assert.equal(getBotAutoFillPolicy("duel", TeamMode.Solo), undefined);
    await testForcedFactionToken();
    console.log("Faction auto-fill smoke test passed: balanced batching, reservations, room capacity, and a shared target above 40 without a 20+20 bot cap.");
}

void main();
