import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Game } from "./game/game.ts";
import type { Player } from "./game/objects/player.ts";

function join(game: Game, token: string, name: string): Player | undefined {
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = name;
    return game.playerBarn.addPlayer(`${name}-${Math.random()}`, msg);
}

async function runNormalExtractionSquad(): Promise<void> {
    const game = new Game(
        `extraction-human-bot-isolation-${Date.now()}`,
        { mapName: "extraction", teamMode: TeamMode.Squad },
        () => {},
        () => {},
    );
    await game.init();

    try {
        game.addJoinToken("bot-a", true, 1, 60_000, false, true);
        game.addJoinToken("bot-b", true, 1, 60_000, false, true);
        const botA = join(game, "bot-a", "BotA");
        const botB = join(game, "bot-b", "BotB");
        assert(botA && botB);
        assert.notEqual(botA.groupId, botB.groupId, "fixture needs separate bot groups");

        // Exact regression: one real player selects Squad + auto-fill teammates.
        game.addJoinToken("human-a", true, 1, 60_000, false, false);
        const humanA = join(game, "human-a", "HumanA");
        assert(humanA);
        assert.ok(
            humanA.group?.players.every((player) => !player.serverBot),
            "Squad auto-fill human must never be placed into a server-bot group",
        );
        assert.notEqual(humanA.groupId, botA.groupId);
        assert.notEqual(humanA.groupId, botB.groupId);

        // Real players can still auto-fill each other.
        game.addJoinToken("human-b", true, 1, 60_000, false, false);
        const humanB = join(game, "human-b", "HumanB");
        assert(humanB);
        assert.equal(
            humanB.groupId,
            humanA.groupId,
            "human auto-fill must continue to combine compatible human squads",
        );
        assert.ok(humanA.group?.players.every((player) => !player.serverBot));

        // Reverse direction is blocked as well.
        game.addJoinToken("bot-c", true, 1, 60_000, false, true);
        const botC = join(game, "bot-c", "BotC");
        assert(botC);
        assert.notEqual(
            botC.groupId,
            humanA.groupId,
            "server bot must never consume a free seat in a human extraction squad",
        );
        assert.ok(botC.group?.players.every((player) => player.serverBot));
    } finally {
        game.stop();
    }
}

async function runSecretExtractionPolicy(): Promise<void> {
    const game = new Game(
        `secret-extraction-human-bot-isolation-${Date.now()}`,
        { mapName: "extraction_secret", teamMode: TeamMode.Squad },
        () => {},
        () => {},
    );
    await game.init();

    try {
        // Secret Squad automatically creates Boss/BossGuard server bots when
        // enabled. Add two regular server bots too so the candidate pool covers
        // both native NPC and smart-bot style groups.
        game.addJoinToken("secret-bot-a", true, 1, 60_000, false, true);
        game.addJoinToken("secret-bot-b", true, 1, 60_000, false, true);
        const botA = join(game, "secret-bot-a", "SecretBotA");
        const botB = join(game, "secret-bot-b", "SecretBotB");
        assert(botA && botB);

        // Exercise grouping directly so the test does not mutate a real stash
        // merely to satisfy secret-loadout admission.
        game.addJoinToken("secret-human", true, 1, 60_000, false, false);
        const humanToken = game.joinTokens.get("secret-human");
        assert(humanToken);
        const selected = game.playerBarn.findFreeGroup(humanToken);
        assert.equal(
            selected.players.length,
            0,
            "secret Squad human auto-fill must select/create a human-only group, not an AI group",
        );
        assert.notEqual(selected.groupId, botA.groupId);
        assert.notEqual(selected.groupId, botB.groupId);
    } finally {
        game.stop();
    }
}

void (async () => {
    await runNormalExtractionSquad();
    await runSecretExtractionPolicy();
    console.log(
        "Extraction human/AI team isolation passed: Squad auto-fill keeps real players together and server bots out, including secret extraction.",
    );
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
