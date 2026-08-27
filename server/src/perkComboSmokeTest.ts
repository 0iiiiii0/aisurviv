import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { MapDefs } from "../../shared/defs/mapDefs.ts";
import * as net from "../../shared/net/net.ts";
import { Config } from "./config.ts";
import { Game } from "./game/game.ts";
import type { Player } from "./game/objects/player.ts";

const previousSecret = { ...Config.extractionSecret };

type MapName = keyof typeof MapDefs;

async function makeGame(mapName: MapName): Promise<Game> {
    const game = new Game(
        `${mapName}-perk-combo-${Math.random().toString(36).slice(2)}`,
        { mapName, teamMode: TeamMode.Solo },
        () => {},
        () => {},
    );
    await game.init();
    return game;
}

function joinPlayer(game: Game, name: string, bot: boolean): Player {
    game.addJoinToken(
        `pc-${name}`,
        bot,
        1,
        60_000,
        false,
        bot,
        undefined,
    );
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = `pc-${name}`;
    msg.name = name;
    const player = game.playerBarn.addPlayer(`${name}-sock`, msg);
    if (!player) throw new Error(`failed to join ${name}`);
    return player;
}

function run5s(player: Player): void {
    for (let i = 0; i < 150; i++) player.update(1 / 30);
}

void (async () => {
    try {
        Config.extractionSecret.enabled = false;
        const game = await makeGame("main");
        const leadershipOnly = joinPlayer(game, "LOnly", false);
        const leadershipLifeline = joinPlayer(game, "LL", false);
        const lifelineOnly = joinPlayer(game, "LfOnly", false);
        const plain = joinPlayer(game, "Plain", false);
        leadershipOnly.addPerk("leadership", false);
        leadershipLifeline.addPerk("leadership", false);
        leadershipLifeline.addPerk("lifeline", false);
        lifelineOnly.addPerk("lifeline", false);
        for (const p of [leadershipOnly, leadershipLifeline, lifelineOnly, plain]) {
            p.boost = 100;
        }

        run5s(leadershipOnly);
        run5s(leadershipLifeline);
        run5s(lifelineOnly);
        run5s(plain);

        const decay = GameConfig.player.boostDecay;
        assert.ok(
            Math.abs(leadershipOnly.boost - 100) < 0.01,
            "leadership alone keeps boost from decaying",
        );
        assert.ok(
            Math.abs(leadershipLifeline.boost - 100) < 0.01,
            "leadership + Indomitable keeps boost from decaying (not invincible: conversion consumes a finite pool)",
        );
        assert.ok(
            lifelineOnly.boost < 99.5 && plain.boost < lifelineOnly.boost,
            "Indomitable slows decay (0.75x) and plain decays normally",
        );
        game.stop();

        // 绝密 AI 满激素 + Indomitable：激素不再每秒补满（防无敌）。
        Config.extractionSecret.enabled = true;
        Config.extractionSecret.immortalBoost = true;
        const secretGame = await makeGame("extraction_secret");
        const lfBot = joinPlayer(secretGame, "LfBot", true);
        (
            secretGame as unknown as {
                applyExtractionSpawnLoadout(p: typeof lfBot): void;
            }
        ).applyExtractionSpawnLoadout(lfBot);
        lfBot.addPerk("lifeline", false);
        lfBot.boost = 100;
        run5s(lfBot);
        assert.ok(
            lfBot.boost < 99.5,
            "secret AI with Indomitable must not refill boost to 100 every frame (true invincibility fix)",
        );

        const lockBot = joinPlayer(secretGame, "LockBot", true);
        (
            secretGame as unknown as {
                applyExtractionSpawnLoadout(p: typeof lockBot): void;
            }
        ).applyExtractionSpawnLoadout(lockBot);
        lockBot.boost = 30;
        run5s(lockBot);
        assert.equal(
            lockBot.boost,
            100,
            "secret AI without Indomitable keeps the immortal boost lock",
        );
        secretGame.stop();

        console.log(
            "Perk combo smoke test passed: leadership+Indomitable keeps boost (not actually invincible), secret-AI immortal+Indomitable fixed (no per-frame refill).",
        );
    } finally {
        Config.extractionSecret = previousSecret;
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
