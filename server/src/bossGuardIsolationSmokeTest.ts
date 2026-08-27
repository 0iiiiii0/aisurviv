import assert from "node:assert/strict";
import { TeamMode } from "../../shared/gameConfig.ts";
import { Config } from "./config.ts";
import { Game } from "./game/game.ts";
import type { Player } from "./game/objects/player.ts";

const previousBoss = JSON.parse(JSON.stringify(Config.extractionBoss)) as
    typeof Config.extractionBoss;
const previousHunters = JSON.parse(JSON.stringify(Config.extractionHunters)) as
    typeof Config.extractionHunters;

function joinSmartBot(game: Game, index: number): Player {
    const player = game.playerBarn.addTestPlayer({ name: `RegularBot${index}` });
    player.serverBot = true;
    player.socketId = `regular-bot-socket-${index}`;
    return player;
}

void (async () => {
    try {
        Config.extractionBoss.enabled = true;
        Config.extractionBoss.minions = { solo: 3, duo: 3, squad: 3 };
        Config.extractionHunters.secret = { solo: 2, duo: 2, squad: 2 };

        const game = new Game(
            `boss-guard-isolation-${Math.random().toString(36).slice(2)}`,
            {
                mapName: "extraction_secret",
                teamMode: TeamMode.Solo,
                extractionSecretEnabled: true,
                extractionBossEnabled: true,
            },
        );

        assert.ok(game.bossPlayers.length >= 1, "secret extraction must spawn a boss");
        assert.equal(
            game.bossMinions.length,
            3,
            "configured guard count is one global quota, not one quota per boss",
        );
        assert.equal(
            new Set(game.bossMinions.map((guard) => guard.socketId)).size,
            game.bossMinions.length,
            "guards belonging to different bosses must have unique socket ids",
        );
        assert.equal(game.started, false, "native boss NPCs must not start the match timer");
        assert.equal(game.connectedCount, 0, "boss NPCs must not consume auto-fill slots");
        assert.equal(game.aiPlayerCount, 0, "boss NPCs must not be reported as regular AI");
        assert.equal(game.serverBotCount, 0, "boss NPCs must not count as smart-bot workers");

        const regularBots = [joinSmartBot(game, 1), joinSmartBot(game, 2)];
        assert.ok(regularBots.every((bot) => !bot.isBoss && !bot.bossMinion));
        assert.equal(game.connectedCount, 2);
        assert.equal(game.aiPlayerCount, 2);
        assert.equal(game.serverBotCount, 2);
        assert.equal(
            game.started,
            false,
            "regular AI still must not start extraction before a human joins",
        );

        game.extraction().update(1.1);
        const hunterIds = (
            game.extraction() as unknown as { hunterBotIds: number[] }
        ).hunterBotIds;
        assert.deepEqual(
            new Set(hunterIds),
            new Set(regularBots.map((bot) => bot.__id)),
            "bosses and guards must not occupy regular extraction hunter slots",
        );

        game.stop();
        console.log(
            "Boss guard isolation smoke test passed: guards use a global quota and do not replace regular AI, hunter slots, or the human start trigger.",
        );
    } finally {
        Config.extractionBoss = previousBoss;
        Config.extractionHunters = previousHunters;
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
