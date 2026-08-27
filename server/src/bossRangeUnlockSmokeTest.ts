import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { Config } from "./config.ts";
import { Game } from "./game/game.ts";
import type { Player } from "./game/objects/player.ts";

const previousBoss = JSON.parse(JSON.stringify(Config.extractionBoss)) as
    typeof Config.extractionBoss;
const previousSecret = { ...Config.extractionSecret };

try {
    Config.extractionSecret.enabled = true;
    Config.extractionBoss.enabled = true;
    Config.extractionBoss.count = 1;
    Config.extractionBoss.bossPositions = {};
    Config.extractionBoss.weapons = [{ type: "m249", count: 1 }];

    const game = new Game(
        `boss-range-unlock-${Math.random().toString(36).slice(2)}`,
        { mapName: "extraction_secret", teamMode: TeamMode.Solo },
    );
    const boss = game.bossPlayers[0];
    assert.ok(boss, "secret extraction must spawn a boss");

    boss.pos = { x: 300, y: 300 };
    boss.layer = 0;
    boss.bossPatrolCenter = { x: 300, y: 300 };
    boss.bossPatrolRadius = 18;
    boss.bossTarget = null;

    const attacker = game.playerBarn.addTestPlayer({
        name: "RangeUnlockAttacker",
        pos: { x: 400, y: 300 },
    });
    attacker.layer = 0;

    const updateBossAI = () => game.updateBossAI(1 / 30);
    updateBossAI();
    assert.equal(boss.bossTarget, null, "an undamaged boss must keep its original range limit");

    // Move close enough to deal damage, then leave both the patrol zone and the
    // old 48-unit chase range. Clear the temporary hit-chase window to prove the
    // permanent unlock, rather than the old six-second exception, drives pursuit.
    attacker.pos = { x: 320, y: 300 };
    boss.damage({
        amount: 1,
        damageType: GameConfig.DamageType.Player,
        dir: { x: 1, y: 0 },
        source: attacker,
        gameSourceType: "m4a1",
    });
    assert.equal(boss.bossRangeUnlocked, true, "effective damage must unlock boss range");

    attacker.pos = { x: 400, y: 300 };
    boss.bossTarget = null;
    boss.bossHitChaseUntil = 0;
    updateBossAI();
    assert.equal(
        boss.bossTarget,
        attacker,
        "a damaged boss must acquire targets beyond its patrol and old chase ranges",
    );
    assert.notEqual(
        boss.bossDecision,
        "edge",
        "a damaged boss must not return to its patrol center because of the old boundary",
    );

    game.stop();
    console.log("boss range unlock smoke test passed");
} finally {
    Object.assign(Config.extractionBoss, previousBoss);
    Object.assign(Config.extractionSecret, previousSecret);
}
