import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { Game } from "./game/game.ts";
import type { JoinTokenData } from "./game/game.ts";
import { NoOpSocket } from "./game/socket.ts";
import type { ClientSocket } from "./game/socket.ts";
import type { Client } from "./game/client.ts";
import type { Player } from "./game/objects/player.ts";
import { clampExtractionReplenishBatch } from "./gameServer.ts";

/**
 * V245 搜打撤补员优化：
 * - 补员批次按实际缺口精确计算（不超标、不一次性补过头）；
 * - bot 阵亡后（smartBot 检测到自身死亡并终止、关闭连接）立即从
 *   serverBotCount 剔除，补员缺口正确触发，同时释放 worker 进程名额。
 */

function addBot(game: Game, index: number): Player {
    const token = `replenish-bot-${index}`;
    game.addJoinToken(token, true, 1, 60_000, false, true, undefined);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = `ReplenishBot${index}`;
    const client = game.clientBarn.addClientWithPlayer(
        new NoOpSocket(),
        game.joinTokens.get(token)?.data as JoinTokenData,
        msg,
        token,
    );
    return client!.player!;
}

void (async () => {
    // 1) 补员批次 = min(缺口, 单 worker 容量)，至少 1。
    assert.equal(clampExtractionReplenishBatch(0, 3), 1, "deficit floors at 1");
    assert.equal(clampExtractionReplenishBatch(1, 3), 1);
    assert.equal(clampExtractionReplenishBatch(2, 3), 2);
    assert.equal(clampExtractionReplenishBatch(5, 3), 3, "capped by worker batch capacity");
    assert.equal(clampExtractionReplenishBatch(5, 8), 5, "no over-fill beyond deficit");
    assert.equal(clampExtractionReplenishBatch(-3, 8), 1);

    // 2) bot 阵亡 + 断开连接后，serverBotCount 下降、缺口可正确计算。
    const game = new Game(`extraction-replenish-${Math.random().toString(36).slice(2)}`, {
        mapName: "extraction",
        teamMode: TeamMode.Solo,
        maxPlayersOverride: 20,
    });

    // 一个真人 + 5 个 bot。
    game.addJoinToken("human", false, 1, 60_000, false, false, undefined);
    const humanMsg = new net.JoinMsg();
    humanMsg.protocol = GameConfig.protocolVersion;
    humanMsg.matchPriv = "human";
    humanMsg.name = "Human";
    assert(
        game.clientBarn.addClientWithPlayer(
            new NoOpSocket(),
            game.joinTokens.get("human")?.data as JoinTokenData,
            humanMsg,
            "human",
        )?.player,
        "human joins",
    );

    const bots: Player[] = [];
    for (let i = 0; i < 5; i++) {
        const bot = addBot(game, i);
        assert(bot, `bot ${i} joins`);
        bots.push(bot);
    }
    assert.equal(game.serverBotCount, 5);
    assert.equal(game.humanPlayerCount, 1);

    // 击杀一个 bot：smartBot 检测到死亡后会终止并断开连接（模拟 handleSocketClose）。
    const target = bots[2]!;
    target.kill({ damageType: 0, dir: v2.create(0, 0), amount: 999 });
    assert.equal(target.dead, true);
    // 尚未断开时 serverBotCount 仍计入（等待 smartBot 释放进程）。
    // smartBot 终止后 ws 关闭 → 服务端标记 disconnected → 立即从 serverBotCount 剔除。
    game.clientBarn.handleSocketClose(
        (target.client as unknown as { socket: ClientSocket<Client> }).socket,
    );
    assert.equal(
        game.serverBotCount,
        4,
        "dead+disconnected bot leaves serverBotCount, so replenish deficit is accurate",
    );

    // 目标：1 真人 + 20 人上限 → 应补到 19 个 AI；已补到的缺口从 5 → 4。
    const targetBots = Math.max(1, 20 - game.humanPlayerCount);
    const deficit = targetBots - game.serverBotCount;
    assert.equal(deficit, 15, "replenish deficit is recomputed after bot release");
    game.stop();

    console.log(
        "Extraction replenish smoke test passed: precise batch clamp, dead+disconnected bots release worker slots and refresh deficit.",
    );
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
