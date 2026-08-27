import assert from "node:assert/strict";
import { TeamMode } from "../../shared/gameConfig.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { Game } from "./game/game.ts";
import { BOT_ONLY_ROOM_GRACE_MS, shouldCloseUnwatchedBotRoom } from "./game/roomLifecycle.ts";

assert.equal(
    shouldCloseUnwatchedBotRoom({
        mapName: "main",
        hadConnectedHuman: false,
        connectedHumanCount: 0,
        disconnectedAliveHumanCount: 0,
        connectedServerBotCount: 12,
    }),
    false,
    "a room must not close before any human has connected",
);

assert.equal(
    shouldCloseUnwatchedBotRoom({
        mapName: "main",
        hadConnectedHuman: true,
        connectedHumanCount: 1,
        disconnectedAliveHumanCount: 0,
        connectedServerBotCount: 12,
    }),
    false,
    "a dead viewer or spectator still counts as a connected human",
);

assert.equal(
    shouldCloseUnwatchedBotRoom({
        mapName: "main",
        hadConnectedHuman: true,
        connectedHumanCount: 0,
        disconnectedAliveHumanCount: 0,
        connectedServerBotCount: 12,
    }),
    true,
    "a previously watched bot-only room should close",
);

assert.equal(
    shouldCloseUnwatchedBotRoom({
        mapName: "duel",
        hadConnectedHuman: true,
        connectedHumanCount: 0,
        disconnectedAliveHumanCount: 0,
        connectedServerBotCount: 1,
    }),
    true,
    "a duel room must close after its last real client leaves",
);

assert.equal(
    shouldCloseUnwatchedBotRoom({
        mapName: "duel",
        hadConnectedHuman: false,
        connectedHumanCount: 0,
        disconnectedAliveHumanCount: 0,
        connectedServerBotCount: 1,
    }),
    false,
    "a never-watched pure-AI duel room remains available",
);

assert.equal(
    shouldCloseUnwatchedBotRoom({
        mapName: "main",
        hadConnectedHuman: true,
        connectedHumanCount: 0,
        disconnectedAliveHumanCount: 0,
        connectedServerBotCount: 0,
    }),
    true,
    "a fully-empty room that previously had a human must also close (no zombie rooms)",
);

assert.equal(
    shouldCloseUnwatchedBotRoom({
        mapName: "main",
        hadConnectedHuman: true,
        connectedHumanCount: 0,
        disconnectedAliveHumanCount: 1,
        connectedServerBotCount: 12,
    }),
    true,
    "a disconnected player record must not retain bots beyond the short room grace period",
);

(() => {
    // 开局后全员阵亡（aliveCount 0）的房间必须关闭：旧代码对空场返回 false，
    // 导致互杀/团灭后房间冻结并残留（真实日志里 50v50 最后两人互杀后房间
    // 未结束）。
    {
        const game = new Game(
            "roomlifecycle-empty-br",
            { mapName: "main", teamMode: TeamMode.Solo },
        );
        const human = game.playerBarn.addTestPlayer({ name: "SoloHuman" });
        game.started = true;
        human.kill({ damageType: 0, dir: v2.create(0, 0), amount: 999 });
        assert.equal(
            game.over,
            true,
            "a started room where every contestant died must close (no frozen empty room)",
        );
        game.stop();
    }

    // 完全空房（0 bot、0 真人、无待重连真人）且来过真人：应被判定为可关闭。
    assert.equal(
        shouldCloseUnwatchedBotRoom({
            mapName: "main",
            hadConnectedHuman: true,
            connectedHumanCount: 0,
            disconnectedAliveHumanCount: 0,
            connectedServerBotCount: 0,
        }),
        true,
        "a fully-empty room must be closable",
    );

    // Integration: a disconnected, still-alive human record must only receive
    // the short room grace. Once it expires, Game.stop() closes the bot socket
    // immediately so the worker process can be reused.
    {
        const game = new Game(
            "roomlifecycle-release-ai",
            { mapName: "main", teamMode: TeamMode.Solo },
        );

        const human = game.playerBarn.addTestPlayer({ name: "Human" });
        human.matchPriv = "human-token";
        game.hadConnectedHuman = true;

        const bot = game.playerBarn.addTestPlayer({ name: "ServerBot" });
        bot.serverBot = true;
        bot.matchPriv = "bot-token";
        const botSocket = bot.client.socket;

        game.clientBarn.handleSocketClose(human.client.socket);
        assert.equal(human.disconnected, true);
        assert.equal(game.pendingHumanCount, 1, "alive reconnect record still exists");
        assert.equal(game.connectedHumanCount, 0, "no real client remains connected");

        const lifecycle = game as unknown as {
            updateBotOnlyShutdown(now: number): void;
        };
        const graceStartedAt = 10_000;
        lifecycle.updateBotOnlyShutdown(graceStartedAt);
        lifecycle.updateBotOnlyShutdown(graceStartedAt + BOT_ONLY_ROOM_GRACE_MS - 1);
        assert.equal(game.stopped, false, "room stays alive during the short reconnect grace");

        lifecycle.updateBotOnlyShutdown(graceStartedAt + BOT_ONLY_ROOM_GRACE_MS);
        assert.equal(game.stopped, true, "room closes as soon as the grace expires");
        assert(
            botSocket.closed(),
            "closing the room must immediately release the connected AI worker",
        );
    }

    console.log("Room lifecycle smoke test passed");
})();
