import assert from "assert/strict";
import { TeamMode } from "../../shared/gameConfig.ts";
import { Config } from "./config.ts";
import {
    DuelLobbyError,
    DuelLobbyService,
    type DuelLobbyLoadout,
    type DuelLobbyMatchRequest,
} from "./duelLobby.ts";
import { createPrivateDuelJoinTokens } from "./duelMatchJoinTokens.ts";
import type { GameData } from "./game/gameManager.ts";

async function testPrivateDuelAiTokenClassification(): Promise<void> {
    const botFlags: boolean[] = [];
    const loadoutIndexes: Array<number | undefined> = [];
    const manager = {
        async createGame(_config: unknown) {
            return { id: "classified-private-duel" };
        },
        async createJoinToken(
            gameId: string,
            _expiresInMs: number,
            _spectator = false,
            _playerCount = 1,
            _autoFill = false,
            serverBot = false,
            _difficulty?: unknown,
            duelLoadoutIndex?: number,
        ) {
            botFlags.push(serverBot);
            loadoutIndexes.push(duelLoadoutIndex);
            return { gameId, data: serverBot ? "server-bot" : `human-${duelLoadoutIndex}` };
        },
    };

    const aiMatch = await createPrivateDuelJoinTokens(
        manager as any,
        { mapName: "duel", teamMode: TeamMode.Solo },
        true,
        300_000,
    );
    assert.equal(aiMatch.humanJoins.length, 1);
    assert.equal(aiMatch.botJoin?.data, "server-bot");
    assert.deepEqual(botFlags, [false, true]);
    assert.deepEqual(loadoutIndexes, [0, 1]);

    botFlags.length = 0;
    loadoutIndexes.length = 0;
    const humanMatch = await createPrivateDuelJoinTokens(
        manager as any,
        { mapName: "duel", teamMode: TeamMode.Solo },
        false,
        300_000,
    );
    assert.equal(humanMatch.humanJoins.length, 2);
    assert.equal(humanMatch.botJoin, null);
    assert.deepEqual(botFlags, [false, false]);
    assert.deepEqual(loadoutIndexes, [0, 1]);
}

async function main(): Promise<void> {
    await testPrivateDuelAiTokenClassification();
    const games = new Map<string, GameData>();
    let createdRequest: DuelLobbyMatchRequest | undefined;
    let createdCount = 0;
    const service = new DuelLobbyService(
        async (request) => {
            createdRequest = request;
            const gameId = `private-duel-${++createdCount}`;
            games.set(gameId, {
                id: gameId,
                teamMode: TeamMode.Solo,
                mapName: "duel",
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
            });
            return {
                gameId,
                matches: Array.from({ length: request.loadout.aiEnabled ? 1 : 2 }, (_, index) => ({
                    zone: "",
                    gameId,
                    useHttps: false,
                    hosts: ["127.0.0.1:8001"],
                    addrs: ["127.0.0.1:8001"],
                    data: `join-token-${index}`,
                })),
            };
        },
        (gameId) => games.get(gameId),
        (gameId) => games.delete(gameId),
    );

    const created = service.create("房主");
    assert.match(created.lobby.code, /^[A-HJ-NP-Z2-9]{6}$/);
    assert.equal(created.lobby.isHost, true);
    assert.equal(created.lobby.players.length, 1);
    assert.deepEqual(created.lobby.loadout.weapons, Config.duel.weapons);
    assert(
        created.lobby.catalog.length >= 65,
        "the duel catalog must retain the legacy weapons while allowing newly ported weapons",
    );
    assert.equal(created.lobby.throwableCatalog.length, 6);
    await assert.rejects(
        () => service.start(created.lobby.code, created.memberToken),
        DuelLobbyError,
    );

    const joined = service.join(created.lobby.code.toLowerCase(), "好友");
    assert.equal(joined.lobby.players.length, 2);
    assert.equal(joined.lobby.isHost, false);
    const hostWeapons = service.updateWeapons(created.lobby.code, created.memberToken, ["ak47", "mosin"]);
    assert.deepEqual(hostWeapons.lobby.myWeapons, ["ak47", "mosin"]);
    const guestWeapons = service.updateWeapons(joined.lobby.code, joined.memberToken, ["m39", "mp220"]);
    assert.deepEqual(guestWeapons.lobby.myWeapons, ["m39", "mp220"]);
    // Per-player throwables: each member picks their own counts.
    const hostThrowables = service.updateThrowables(created.lobby.code, created.memberToken, {
        frag: 3,
        mirv: 0,
        smoke: 2,
        strobe: 0,
        snowball: 0,
        potato: 0,
    });
    assert.deepEqual(hostThrowables.lobby.myThrowables, {
        frag: 3,
        mirv: 0,
        smoke: 2,
        strobe: 0,
        snowball: 0,
        potato: 0,
    });
    const guestThrowables = service.updateThrowables(
        created.lobby.code,
        joined.memberToken,
        { frag: 0, mirv: 1, smoke: 0, strobe: 4, snowball: 0, potato: 0 },
    );
    assert.deepEqual(guestThrowables.lobby.myThrowables, {
        frag: 0,
        mirv: 1,
        smoke: 0,
        strobe: 4,
        snowball: 0,
        potato: 0,
    });
    // The opponent card summary exposes the other player's throwables.
    const hostView = service.status(created.lobby.code, created.memberToken);
    assert.deepEqual(hostView.lobby.players[1].throwables, {
        frag: 0,
        mirv: 1,
        smoke: 0,
        strobe: 4,
        snowball: 0,
        potato: 0,
    });
    assert.throws(
        () =>
            service.updateLoadout(
                joined.lobby.code,
                joined.memberToken,
                joined.lobby.loadout,
            ),
        DuelLobbyError,
    );
    // 满员/对局中/AI 房间的加入都必须明确拒绝（防止多人加入）。
    try {
        service.join(created.lobby.code, "第三人");
        assert.fail("full lobby must reject a third joiner");
    } catch (error) {
        assert.ok(
            error instanceof DuelLobbyError && error.message.includes("满员"),
            `full lobby must reject with a clear prompt, got: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    assert.equal(
        service.status(created.lobby.code, created.memberToken).lobby.players.length,
        2,
        "rejected join must not mutate the lobby roster",
    );

    const customLoadout: DuelLobbyLoadout = {
        weapons: ["ak47", "mosin"],
        weaponSelectionMode: "individual",
        adrenalineEnabled: true,
        boost: 55,
        aiEnabled: false,
        aiDifficulty: "normal",
        helmetLevel: 3,
        chestLevel: 1,
        scope: "8xscope",
        throwables: {
            frag: 2,
            mirv: 0,
            smoke: 1,
            strobe: 0,
            snowball: 0,
            potato: 3,
        },
    };
    const updated = service.updateLoadout(
        created.lobby.code,
        created.memberToken,
        customLoadout,
    );
    assert.deepEqual(updated.lobby.loadout, customLoadout);

    const started = await service.start(created.lobby.code, created.memberToken);
    assert.equal(started.lobby.status, "playing");
    assert.equal(started.lobby.matchData?.data, "join-token-0");
    assert.deepEqual(createdRequest?.loadout, customLoadout);
    assert.equal(createdRequest?.defaultLoadout, false);
    assert.deepEqual(createdRequest?.contestantLoadouts, [
        {
            weapons: ["ak47", "mosin"],
            throwables: { frag: 3, mirv: 0, smoke: 2, strobe: 0, snowball: 0, potato: 0 },
        },
        {
            weapons: ["m39", "mp220"],
            throwables: { frag: 0, mirv: 1, smoke: 0, strobe: 4, snowball: 0, potato: 0 },
        },
    ]);

    const previousDefaults = {
        aiEnabled: Config.duel.aiEnabled,
        aiDifficulty: Config.duel.aiDifficulty,
    };
    Config.duel.aiEnabled = true;
    Config.duel.aiDifficulty = "legit";
    const defaultChallenge = service.create("默认挑战房主");
    await service.start(defaultChallenge.lobby.code, defaultChallenge.memberToken);
    assert.equal(createdRequest?.defaultLoadout, true);
    Config.duel.aiEnabled = previousDefaults.aiEnabled;
    Config.duel.aiDifficulty = previousDefaults.aiDifficulty;
    const guestPlaying = service.status(created.lobby.code, joined.memberToken);
    assert.equal(guestPlaying.lobby.matchData?.data, "join-token-1");
    assert.equal(guestPlaying.lobby.matchId, started.lobby.matchId);

    const game = games.get(started.lobby.matchId!);
    assert(game);
    game.stopped = true;
    const returned = service.status(created.lobby.code, created.memberToken);
    assert.equal(returned.lobby.status, "waiting");
    assert.equal(returned.lobby.players.length, 2);
    assert.equal(returned.lobby.matchData, null);
    assert.equal(returned.lobby.awaitingReturns, true);
    assert.equal(returned.lobby.returnedCount, 1);
    assert.equal(returned.lobby.canStart, false);
    assert.throws(
        () => service.updateLoadout(created.lobby.code, created.memberToken, customLoadout),
        DuelLobbyError,
    );
    const guestReturned = service.status(created.lobby.code, joined.memberToken);
    assert.equal(guestReturned.lobby.awaitingReturns, false);
    assert.equal(guestReturned.lobby.returnedCount, 2);
    assert.equal(service.status(created.lobby.code, created.memberToken).lobby.canStart, true);

    assert.deepEqual(service.leave(created.lobby.code, joined.memberToken), {
        closed: false,
    });
    assert.equal(service.status(created.lobby.code, created.memberToken).lobby.players.length, 1);
    assert.deepEqual(service.leave(created.lobby.code, created.memberToken), {
        closed: true,
    });
    assert.throws(
        () => service.status(created.lobby.code, created.memberToken),
        DuelLobbyError,
    );

    const aiLobby = service.create("单人房主");
    service.updateWeapons(
        aiLobby.lobby.code,
        aiLobby.memberToken,
        ["mosin", "mp220"],
    );
    const aiLoadout: DuelLobbyLoadout = {
        ...aiLobby.lobby.loadout,
        // Simulate an old/stale client trying to submit an asymmetric AI pair.
        weapons: ["ak47", "m39"],
        weaponSelectionMode: "exclusive",
        adrenalineEnabled: false,
        boost: 80,
        aiEnabled: true,
        aiDifficulty: "pro",
    };
    const aiUpdated = service.updateLoadout(
        aiLobby.lobby.code,
        aiLobby.memberToken,
        aiLoadout,
    );
    assert.equal(aiUpdated.lobby.players.length, 2);
    assert.equal(aiUpdated.lobby.players[1].ai, true);
    assert.equal(aiUpdated.lobby.loadout.weaponSelectionMode, "mirrored");
    assert.deepEqual(aiUpdated.lobby.loadout.weapons, ["mosin", "mp220"]);
    assert.deepEqual(aiUpdated.lobby.players[1].weapons, ["mosin", "mp220"]);
    assert.equal(aiUpdated.lobby.canStart, true);
    assert.throws(() => service.join(aiLobby.lobby.code, "真人二号"), DuelLobbyError);
    // Human-vs-AI mirrors the host's throwables like it mirrors weapons.
    service.updateThrowables(aiLobby.lobby.code, aiLobby.memberToken, {
        frag: 0,
        mirv: 0,
        smoke: 1,
        strobe: 5,
        snowball: 0,
        potato: 2,
    });
    const aiStatus = service.status(aiLobby.lobby.code, aiLobby.memberToken);
    assert.deepEqual(aiStatus.lobby.players[1].throwables, {
        frag: 0,
        mirv: 0,
        smoke: 1,
        strobe: 5,
        snowball: 0,
        potato: 2,
    });
    assert.deepEqual(aiStatus.lobby.loadout.throwables, {
        frag: 0,
        mirv: 0,
        smoke: 1,
        strobe: 5,
        snowball: 0,
        potato: 2,
    });
    const aiStarted = await service.start(aiLobby.lobby.code, aiLobby.memberToken);
    assert.equal(aiStarted.lobby.status, "playing");
    assert.equal(aiStarted.lobby.matchData?.data, "join-token-0");
    assert.equal(createdRequest?.loadout.aiDifficulty, "pro");
    assert.equal(createdRequest?.loadout.adrenalineEnabled, false);
    assert.equal(createdRequest?.loadout.scope, aiLoadout.scope);
    assert.deepEqual(createdRequest?.contestantLoadouts, [
        {
            weapons: ["mosin", "mp220"],
            throwables: { frag: 0, mirv: 0, smoke: 1, strobe: 5, snowball: 0, potato: 2 },
        },
        {
            weapons: ["mosin", "mp220"],
            throwables: { frag: 0, mirv: 0, smoke: 1, strobe: 5, snowball: 0, potato: 2 },
        },
    ]);

    const mirroredLobby = service.create("镜像房主");
    const mirroredGuest = service.join(mirroredLobby.lobby.code, "镜像对手");
    service.updateWeapons(mirroredLobby.lobby.code, mirroredLobby.memberToken, ["awc", "m1014"]);
    service.updateWeapons(mirroredLobby.lobby.code, mirroredGuest.memberToken, ["m9", "m870"]);
    service.updateLoadout(mirroredLobby.lobby.code, mirroredLobby.memberToken, {
        ...mirroredLobby.lobby.loadout,
        weaponSelectionMode: "mirrored",
        aiEnabled: false,
    });
    await service.start(mirroredLobby.lobby.code, mirroredLobby.memberToken);
    assert.deepEqual(createdRequest?.contestantLoadouts, [
        { weapons: ["awc", "m1014"], throwables: { ...Config.duel.throwables } },
        { weapons: ["awc", "m1014"], throwables: { ...Config.duel.throwables } },
    ]);

    const exclusiveLobby = service.create("独占房主");
    const exclusiveGuest = service.join(exclusiveLobby.lobby.code, "独占对手");
    service.updateWeapons(exclusiveLobby.lobby.code, exclusiveLobby.memberToken, ["ak47", "mosin"]);
    service.updateWeapons(exclusiveLobby.lobby.code, exclusiveGuest.memberToken, ["m39", "mp220"]);
    service.updateLoadout(exclusiveLobby.lobby.code, exclusiveLobby.memberToken, {
        ...exclusiveLobby.lobby.loadout,
        weaponSelectionMode: "exclusive",
        aiEnabled: false,
    });
    assert.throws(
        () => service.updateWeapons(exclusiveLobby.lobby.code, exclusiveGuest.memberToken, ["ak47", "mp220"]),
        DuelLobbyError,
    );
    // The rejected update must not mutate the member's previous legal pair.
    assert.deepEqual(
        service.status(exclusiveLobby.lobby.code, exclusiveGuest.memberToken).lobby.myWeapons,
        ["m39", "mp220"],
    );
    await service.start(exclusiveLobby.lobby.code, exclusiveLobby.memberToken);
    assert.deepEqual(createdRequest?.contestantLoadouts, [
        { weapons: ["ak47", "mosin"], throwables: { ...Config.duel.throwables } },
        { weapons: ["m39", "mp220"], throwables: { ...Config.duel.throwables } },
    ]);

    console.log(
        "Duel lobby smoke test passed: human invite, independent/mirrored/exclusive weapon modes, AI opponent, customization, start and return flow.",
    );
}

void main();
