import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Game } from "./game/game.ts";
import type { Player } from "./game/objects/player.ts";

function join(
    game: Game,
    token: string,
    name: string,
    account = "",
): Player | undefined {
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = name;
    msg.loadoutPriv = account;
    return game.playerBarn.addPlayer(`${name}-${Math.random()}`, msg);
}

async function run(): Promise<void> {
    const game = new Game(
        `extraction-party-autofill-${Date.now()}`,
        { mapName: "extraction", teamMode: TeamMode.Duo },
        () => {},
        () => {},
    );

    try {
        await game.init();

        // Reproduce a realistic extraction room: two existing auto-fill bots
        // occupy separate half-full Duo groups.
        game.addJoinToken("existing-bot-1", true, 1, 60_000, false, true);
        game.addJoinToken("existing-bot-2", true, 1, 60_000, false, true);
        const bot1 = join(game, "existing-bot-1", "ExistingBot1");
        const bot2 = join(game, "existing-bot-2", "ExistingBot2");
        assert(bot1 && bot2);
        assert.notEqual(bot1.groupId, bot2.groupId, "fixture must start with two half-full groups");

        // This matches TeamMenu.play(): one shared token, autoFill=true,
        // playerCount=2. Before V258, P1 could be merged with ExistingBot1;
        // P2 then found that group full and was pushed into a different group.
        game.addJoinToken("human-party", true, 2, 60_000, false, false);
        const p1 = join(game, "human-party", "PartyP1", "PartyP1");
        assert(p1, "first party member must join");

        const partyGroup = p1.group;
        assert(partyGroup, "first party member must have a group");
        assert.equal(
            partyGroup.reservedSlots,
            1,
            "first party member must reserve the teammate's seat",
        );

        // Try to race an auto-fill bot into the room before P2 connects. It
        // must not consume the seat reserved for the shared party token.
        game.addJoinToken("racing-bot", true, 1, 60_000, false, true);
        const racingBot = join(game, "racing-bot", "RacingBot");
        assert(racingBot, "racing bot must join");
        assert.notEqual(
            racingBot.groupId,
            p1.groupId,
            "auto-fill must not steal a reserved party seat",
        );

        const p2 = join(game, "human-party", "PartyP2", "PartyP2");
        assert(p2, "second party member must join");
        assert.equal(
            p2.groupId,
            p1.groupId,
            "shared TeamMenu token members must remain in the same extraction group",
        );
        assert.equal(
            partyGroup.reservedSlots,
            0,
            "party reservation must be fully consumed after the teammate joins",
        );
        assert.equal(
            partyGroup.players.length,
            2,
            "Duo party group must contain exactly both invited players",
        );

        console.log(
            `Extraction TeamMenu auto-fill regression passed: P1/P2 stayed in group ${p1.groupId}; reserved seat was protected.`,
        );
    } finally {
        game.stop();
    }
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
