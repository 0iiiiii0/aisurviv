import assert from "assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Game } from "./game/game.ts";


async function testObserverFirstPacket(): Promise<void> {
    const sent: Array<{ socketId: string; data: ArrayBuffer | Uint8Array }> = [];
    const game = new Game(
        "spectator-first-packet",
        { mapName: "faction", teamMode: TeamMode.Squad },
        (socketId, data) => sent.push({ socketId, data }),
        () => {},
    );
    await game.init();

    const addPlayer = (
        socketId: string,
        name: string,
        spectator = false,
    ) => {
        const token = `first-packet-${socketId}`;
        game.addJoinToken(token, true, 1, 60_000, spectator);
        const join = new net.JoinMsg();
        join.protocol = GameConfig.protocolVersion;
        join.matchPriv = token;
        join.name = name;
        const player = game.playerBarn.addPlayer(socketId, join);
        assert(player);
        return player;
    };

    // Reproduce the real room-start order: the observer opens the match before
    // the automatic bot filler has connected the first contestant.
    const earlyObserver = addPlayer("socket-early-observer", "Early Observer", true);
    assert.equal(earlyObserver.spectating, undefined);

    const firstContestant = addPlayer("socket-first-contestant", "First Contestant");
    assert.equal(earlyObserver.spectating, firstContestant);

    // A mid-game observer's first packet must contain metadata for the camera
    // target even when that target has already completed its own first update.
    firstContestant.sendMsgs();
    game.playerBarn.flush();

    const lateObserver = addPlayer("socket-late-observer", "Late Observer", true);
    assert.equal(lateObserver.spectating, firstContestant);

    let capturedUpdate: net.UpdateMsg | undefined;
    const originalSerialize = net.UpdateMsg.prototype.serialize;
    net.UpdateMsg.prototype.serialize = function (stream) {
        capturedUpdate = this;
        return originalSerialize.call(this, stream);
    };
    try {
        lateObserver.sendMsgs();
    } finally {
        net.UpdateMsg.prototype.serialize = originalSerialize;
    }

    assert(capturedUpdate);
    assert.equal(capturedUpdate.activePlayerIdDirty, true);
    assert.equal(capturedUpdate.activePlayerId, firstContestant.__id);
    assert(
        capturedUpdate.fullObjects.some((object) => object.__id === firstContestant.__id),
        "first observer update must include the active camera target object",
    );
    assert(
        capturedUpdate.playerInfos.some(
            (info) => info.playerId === firstContestant.__id && info.name === "First Contestant",
        ),
        "first observer update must include the active target PlayerInfo",
    );

    // Even if an observer somehow becomes unbound, its next update must attach
    // to a valid living target rather than streaming its own dead body.
    lateObserver.spectating = undefined;
    capturedUpdate = undefined;
    net.UpdateMsg.prototype.serialize = function (stream) {
        capturedUpdate = this;
        return originalSerialize.call(this, stream);
    };
    try {
        lateObserver.sendMsgs();
    } finally {
        net.UpdateMsg.prototype.serialize = originalSerialize;
    }
    assert.equal(lateObserver.spectating, firstContestant);
    const reboundUpdate = capturedUpdate as net.UpdateMsg | undefined;
    assert(reboundUpdate);
    assert.equal(reboundUpdate.activePlayerIdDirty, true);
    assert.equal(reboundUpdate.activePlayerId, firstContestant.__id);

    assert(sent.some((entry) => entry.socketId === lateObserver.socketId));
}

async function main(): Promise<void> {
    const game = new Game(
        "spectator-autofill-smoke",
        { mapName: "main", teamMode: TeamMode.Duo },
        () => {},
        () => {},
    );
    await game.init();

    const addPlayer = (
        socketId: string,
        name: string,
        options: { spectator?: boolean; serverBot?: boolean } = {},
    ) => {
        const token = `token-${socketId}`;
        game.addJoinToken(
            token,
            true,
            1,
            60_000,
            options.spectator ?? false,
            options.serverBot ?? false,
        );
        const join = new net.JoinMsg();
        join.protocol = GameConfig.protocolVersion;
        join.matchPriv = token;
        join.name = name;
        const player = game.playerBarn.addPlayer(socketId, join);
        assert(player);
        return player;
    };

    const first = addPlayer("socket-first", "First");
    addPlayer("socket-second", "Second");
    addPlayer("socket-bot", "Server Bot", { serverBot: true });
    const spectator = addPlayer("socket-spectator", "Observer", { spectator: true });

    assert.equal(game.connectedCount, 3);
    assert.equal(game.humanPlayerCount, 2);
    assert.equal(game.aiPlayerCount, 1);
    assert.equal(game.serverBotCount, 1);
    assert.equal(game.spectatorCount, 1);
    assert.equal(spectator.spectatorOnly, true);
    assert(spectator.spectating);

    const next = new net.SpectateMsg();
    next.specNext = true;
    spectator.spectate(next);
    assert(spectator.spectating);

    const targetBeforeDisconnect = spectator.spectating;
    game.handleSocketClose(targetBeforeDisconnect.socketId);
    assert.notEqual(spectator.spectating, targetBeforeDisconnect);
    assert.equal(targetBeforeDisconnect.spectatorCount, 0);

    // A disconnected target must never be selected again.
    const previous = new net.SpectateMsg();
    previous.specPrev = true;
    spectator.spectate(previous);
    assert.notEqual(spectator.spectating, targetBeforeDisconnect);

    game.handleSocketClose(first.socketId);
    assert(game.connectedCount <= 2);

    await testObserverFirstPacket();

    console.log(
        "Spectator/auto-fill smoke test passed: target metadata, observer-before-bots binding, switching, disconnect fallback, and room counts.",
    );
}

void main();
