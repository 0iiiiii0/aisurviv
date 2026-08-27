import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { JoinMsg } from "../../shared/net/joinMsg.ts";
import { Game } from "./game/game.ts";
import { NoOpSocket } from "./game/socket.ts";

function joinContestant(
    game: Game,
    token: string,
    name: string,
    serverBot: boolean,
) {
    game.addJoinToken(token, false, 1, 60_000, false, serverBot);
    const msg = new JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.joinToken = token;
    msg.name = name;
    msg.bot = serverBot;
    const joinData = game.joinTokens.get(token)?.data;
    assert(joinData);
    const client = game.clientBarn.addClientWithPlayer(
        new NoOpSocket(),
        joinData,
        msg,
        token,
    );
    return client?.player;
}

const game = new Game("duel-start-gate", {
    mapName: "duel",
    teamMode: TeamMode.Solo,
    privateGame: true,
    duelAiEnabled: true,
    duelAiDifficulty: "legit",
});

const human = joinContestant(game, "human-token", "Human", false);
assert(human);
game.update(0.01);
assert.equal(game.started, false, "a duel must remain locked with only one contestant");
assert.equal(human.timeAlive, 0, "the arena intentionally freezes contestants before it is full");

const bot = joinContestant(game, "bot-token", "AI-legit", true);
assert(bot);
assert.equal(bot.serverBot, true);
game.update(0.01);

assert.equal(
    game.started,
    true,
    "a full human/AI duel must start without waiting for frozen timeAlive counters",
);
assert.equal(game.arenaPlayersLocked, false);
assert(game.startedTime > 0);

game.stop();

console.log("Duel start-gate smoke test passed: a full human/AI arena starts without a timeAlive deadlock.");
