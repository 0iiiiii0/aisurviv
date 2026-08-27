import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { JoinMsg } from "../../shared/net/joinMsg.ts";
import { Game } from "./game/game.ts";
import { ClientSocket } from "./game/socket.ts";

class CapturingSocket<T extends object> extends ClientSocket<T> {
    private isClosed = false;
    readonly packets: Uint8Array<ArrayBuffer>[] = [];

    ip(): string {
        return "203.0.113.25";
    }

    closed(): boolean {
        return this.isClosed;
    }

    send(data: Uint8Array<ArrayBuffer>): void {
        this.packets.push(data.slice());
    }

    close(): void {
        this.isClosed = true;
    }
}

function joinMessage(token: string, name: string, bot = false): JoinMsg {
    const msg = new JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.joinToken = token;
    msg.matchPriv = token;
    msg.name = name;
    msg.bot = bot;
    return msg;
}

const game = new Game("external-faction-spectate", {
    mapName: "faction",
    teamMode: TeamMode.Squad,
    privateGame: true,
    pureAiMatch: true,
});

for (let index = 0; index < 60; index++) {
    const token = `remote-bot-${index}`;
    const teamId = (index % 2) + 1;
    game.addJoinToken(token, true, 1, 60_000, false, true, [teamId]);
    const client = game.clientBarn.addClientWithPlayer(
        new CapturingSocket(),
        game.joinTokens.get(token)?.data!,
        joinMessage(token, `Remote AI ${index + 1}`, true),
        token,
    );
    assert(client?.player, `remote bot ${index + 1} must join`);
}

assert.equal(game.serverBotCount, 60);
assert.deepEqual(game.playerBarn.teams.map((team) => team.livingPlayers.length), [30, 30]);

const observerToken = "external-faction-observer";
game.addJoinToken(observerToken, false, 1, 60_000, true);
const observerSocket = new CapturingSocket();
const observerClient = game.clientBarn.addClientWithPlayer(
    observerSocket,
    game.joinTokens.get(observerToken)?.data!,
    joinMessage(observerToken, "External AI Viewer"),
    observerToken,
);

assert(observerClient?.player?.spectatorOnly);
assert(observerClient.spectating?.serverBot);
assert.equal(game.spectatorCount, 1);
assert.doesNotThrow(() => observerClient.sendMsgs());
assert.equal(observerSocket.closed(), false);
assert.equal(observerSocket.packets.length, 1);
assert(observerSocket.packets[0].byteLength > 0);

game.stop();

console.log(
    `External faction spectate smoke test passed: 60 remote bots, ${observerSocket.packets[0].byteLength}-byte observer first packet.`,
);
