import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { JoinMsg } from "../../shared/net/joinMsg.ts";
import { Game } from "./game/game.ts";
import { NoOpSocket } from "./game/socket.ts";

function joinMessage(token: string, name: string) {
    const msg = new JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.joinToken = token;
    msg.name = name;
    return msg;
}

const game = new Game("public-spectate-token", {
    mapName: "main",
    teamMode: TeamMode.Solo,
});

game.addJoinToken("contestant", false, 1, 60_000);
const contestantJoin = joinMessage("contestant", "Contestant");
const contestant = game.clientBarn.addClientWithPlayer(
    new NoOpSocket(),
    game.joinTokens.get("contestant")?.data!,
    contestantJoin,
    "contestant",
)?.player;
assert(contestant);
game.joinTokens.delete("contestant");

game.addJoinToken("spectator", false, 1, 60_000, true);
const spectatorJoin = joinMessage("spectator", "Viewer");
const spectatorClient = game.clientBarn.addClientWithPlayer(
    new NoOpSocket(),
    game.joinTokens.get("spectator")?.data!,
    spectatorJoin,
    "spectator",
);
const spectator = spectatorClient?.player;
assert(spectator?.spectatorOnly);
assert.equal(spectator.spectating, contestant);
assert.equal(game.reservedHumanCount, 0, "observer tokens do not reserve contestant slots");

spectatorClient.disconnected = true;
const refreshed = game.clientBarn.tryReconnectClient(
    new NoOpSocket(),
    "spectator",
    joinMessage("spectator", "Viewer"),
    game.joinTokens.get("spectator")?.data,
    game.joinTokens.get("spectator")?.remainingUses,
);
assert.equal(refreshed, true, "a persisted observer token must reconnect after refresh");
assert.equal(spectator.disconnected, false);
assert.equal(game.joinTokens.has("spectator"), true, "observer token remains reusable until expiry");

game.stop();

console.log(
    "Public spectate token smoke test passed: observer joins do not consume slots or block refresh reconnects.",
);
