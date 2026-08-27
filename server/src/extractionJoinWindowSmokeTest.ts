import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Config } from "./config.ts";
import { Game } from "./game/game.ts";

/**
 * V242 搜打撤加入窗口：
 * - 绝密模式最晚开局 2 分钟加入（普通模式仍是 5 分钟）；
 * - 普通模式允许满员后加入真人（5 分钟前），加入时挤掉一个 AI 腾位。
 */

const MAX = 20;

async function makeGame(secret = false): Promise<Game> {
    const game = new Game(
        `extraction-join-window-${Math.random().toString(36).slice(2)}`,
        {
            mapName: "extraction",
            teamMode: TeamMode.Solo,
            maxPlayersOverride: MAX,
            extractionSecretEnabled: secret,
        },
        () => {},
        () => {},
    );
    await game.init();
    return game;
}

function addBot(game: Game, index: number) {
    const token = `bot-token-${index}-${Math.random().toString(36).slice(2)}`;
    game.addJoinToken(token, true, 1, 60_000, false, true, undefined);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = `Bot${index}`;
    return game.playerBarn.addPlayer(`bot-socket-${token}`, msg);
}

function addHuman(game: Game, index: number) {
    const token = `human-token-${index}-${Math.random().toString(36).slice(2)}`;
    game.addJoinToken(token, false, 1, 60_000, false, false, undefined);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = `Human${index}`;
    return game.playerBarn.addPlayer(`human-socket-${token}`, msg);
}

void (async () => {
    // 1) 普通模式：满员后（5 分钟前）真人仍可加入，并挤掉一个 AI 腾位。
    {
        const game = await makeGame(false);
        for (let i = 0; i < MAX; i++) {
            assert(addBot(game, i), `bot ${i} must join`);
        }
        assert.equal(game.aliveCount, MAX, "room is full with AI");
        assert.equal(game.canJoin, true, "normal extraction canJoin true while full (window open)");
        assert.equal(
            game.canAcceptExtractionHuman(),
            true,
            "normal extraction accepts human while full (window open)",
        );

        const beforeBotCount = game.serverBotCount;
        const human = addHuman(game, 0);
        assert(human, "human must join a full normal extraction room");
        assert.equal(game.aliveCount, MAX, "alive count stays at cap after eviction");
        assert.equal(game.humanPlayerCount, 1, "human is counted");
        assert.equal(
            game.serverBotCount,
            beforeBotCount - 1,
            "one AI must be evicted to make room",
        );
        game.stop();
    }

    // 2) 普通模式：优先踢掉已断线的 AI。
    {
        const closed: string[] = [];
        const g2 = new Game(
            "extraction-evict-pref",
            {
                mapName: "extraction",
                teamMode: TeamMode.Solo,
                maxPlayersOverride: MAX,
                extractionSecretEnabled: false,
            },
            () => {},
            (socketId) => closed.push(socketId),
        );
        await g2.init();
        for (let i = 0; i < MAX; i++) {
            const token = `b-${i}`;
            g2.addJoinToken(token, true, 1, 60_000, false, true, undefined);
            const msg = new net.JoinMsg();
            msg.protocol = GameConfig.protocolVersion;
            msg.matchPriv = token;
            msg.name = `B${i}`;
            const bot = g2.playerBarn.addPlayer(`s-${i}`, msg);
            assert(bot);
            if (i === 3) {
                (bot as unknown as { disconnected: boolean }).disconnected = true;
            }
        }
        const humanToken = "h0";
        g2.addJoinToken(humanToken, false, 1, 60_000, false, false, undefined);
        const humanMsg = new net.JoinMsg();
        humanMsg.protocol = GameConfig.protocolVersion;
        humanMsg.matchPriv = humanToken;
        humanMsg.name = "H0";
        const human = g2.playerBarn.addPlayer("hs", humanMsg);
        assert(human, "human joins despite full room");
        assert(closed.includes("s-3"), "disconnected AI is evicted first");
        g2.stop();
    }

    // 3) 普通模式：房间全是真人、无 AI 可踢时拒绝加入。
    {
        const game = await makeGame(false);
        for (let i = 0; i < MAX; i++) {
            assert(addHuman(game, i), `human ${i} must join`);
        }
        assert.equal(game.aliveCount, MAX);
        assert.equal(
            addHuman(game, MAX),
            undefined,
            "21st human is rejected when no AI is available to evict",
        );
        assert.equal(game.aliveCount, MAX, "no overflow when eviction is impossible");
        // 被拒绝的加入不能消耗 token（#6：加入校验通过前不扣使用次数）。
        const overfullToken = "overfull-human";
        game.addJoinToken(overfullToken, false, 1, 60_000, false, false, undefined);
        const overfullMsg = new net.JoinMsg();
        overfullMsg.protocol = GameConfig.protocolVersion;
        overfullMsg.matchPriv = overfullToken;
        overfullMsg.name = "Overfull";
        assert.equal(
            game.playerBarn.addPlayer("overfull-socket", overfullMsg),
            undefined,
            "overfull human is rejected",
        );
        assert.equal(
            game.joinTokens.get(overfullToken)?.avaliableUses,
            1,
            "rejected overfull join must not consume the token",
        );
        game.stop();
    }

    // 4) 普通模式：超过 5 分钟后窗口关闭，满员/未满员都不再接受真人。
    {
        const game = await makeGame(false);
        game.startedTime = 301;
        assert.equal(game.canJoin, false, "normal window closed after 5 minutes");
        assert.equal(
            game.canAcceptExtractionHuman(),
            false,
            "normal extraction rejects human after 5 minutes",
        );
        const token = "late-human";
        game.addJoinToken(token, false, 1, 60_000, false, false, undefined);
        const msg = new net.JoinMsg();
        msg.protocol = GameConfig.protocolVersion;
        msg.matchPriv = token;
        msg.name = "LateHuman";
        assert.equal(
            game.playerBarn.addPlayer("late-socket", msg),
            undefined,
            "human join after 5 minutes is rejected",
        );
        assert.equal(
            game.joinTokens.get(token)?.avaliableUses,
            1,
            "rejected late join must not consume the token",
        );
        game.stop();
    }

    // 5) 绝密模式：窗口为开局 2 分钟；未满员时 120 秒可加入、121 秒拒绝。
    {
        const game = await makeGame(true);
        assert.equal(game.extractionSecretEnabled, true);
        assert.equal(game.canJoin, true, "secret room joinable at start");
        game.startedTime = 120;
        assert.equal(game.secretJoinableWindowOpen, true, "secret window open at exactly 2 min");
        assert.equal(game.canAcceptExtractionHuman(), true);
        game.startedTime = 121;
        assert.equal(game.secretJoinableWindowOpen, false, "secret window closed after 2 min");
        assert.equal(game.canJoin, false, "secret room not joinable after 2 min");
        assert.equal(game.canAcceptExtractionHuman(), false);
        const token = "secret-human";
        game.addJoinToken(token, false, 1, 60_000, false, false, undefined);
        const msg = new net.JoinMsg();
        msg.protocol = GameConfig.protocolVersion;
        msg.matchPriv = token;
        msg.name = "SecretLate";
        assert.equal(
            game.playerBarn.addPlayer("secret-late-socket", msg),
            undefined,
            "secret human join after 2 minutes is rejected",
        );
        assert.equal(
            game.joinTokens.get(token)?.avaliableUses,
            1,
            "rejected secret late join must not consume the token",
        );
        game.stop();
    }

    // 6) 绝密模式：满员时不允许真人加入（不踢 AI）。
    {
        const game = await makeGame(true);
        for (let i = 0; i < MAX; i++) {
            assert(addBot(game, i), `secret bot ${i} must join`);
        }
        assert.equal(game.aliveCount, MAX);
        const fullHumanToken = "secret-full-human";
        game.addJoinToken(fullHumanToken, false, 1, 60_000, false, false, undefined);
        const fullHumanMsg = new net.JoinMsg();
        fullHumanMsg.protocol = GameConfig.protocolVersion;
        fullHumanMsg.matchPriv = fullHumanToken;
        fullHumanMsg.name = "SecretFull";
        assert.equal(
            game.playerBarn.addPlayer("secret-full-socket", fullHumanMsg),
            undefined,
            "secret mode rejects human when full (no eviction)",
        );
        assert.equal(
            game.joinTokens.get(fullHumanToken)?.avaliableUses,
            1,
            "rejected secret full join must not consume the token",
        );
        assert.equal(game.serverBotCount, MAX, "secret room keeps all AI when full");
        game.stop();
    }

    console.log(
        "Extraction join window smoke test passed: secret 2-min window, normal full-room human join with AI eviction, late-join rejection.",
    );
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
