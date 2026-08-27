import assert from "assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { planBrStrobeBarrage } from "./bot/brStrobeBarrage.ts";
import {
    planForbiddenCounterStrobes,
    planForbiddenStrobeCarpet,
} from "./bot/forbiddenCombat.ts";
import { Game } from "./game/game.ts";
import { Player } from "./game/objects/player.ts";

function join(game: Game, socketId: string, token: string, name: string, teamId: number): Player {
    game.addJoinToken(token, true, teamId, 60_000, false, false, [teamId]);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = name;
    const player = game.playerBarn.addPlayer(socketId, msg);
    assert(player);
    return player;
}

async function main(): Promise<void> {
    const base = {
        enemyVisible: true,
        millisecondsSinceDamage: 5000,
        reloadingOrHealing: false,
    };

    // --- pure planner gates ---
    assert.equal(
        planBrStrobeBarrage({ ...base, strobeCount: 0, hostilePressure: 0, enemyDistance: 25 }),
        null,
        "no beacons -> no barrage",
    );
    assert.equal(
        planBrStrobeBarrage({ ...base, strobeCount: 2, hostilePressure: 0, enemyDistance: 25 }),
        null,
        "small stock without hostile pressure -> reserve only",
    );
    const proactive = planBrStrobeBarrage({
        ...base,
        strobeCount: 8,
        hostilePressure: 0,
        enemyDistance: 25,
    });
    assert(proactive, "large stock -> proactive carpet");
    assert.equal(proactive!.counter, false);
    assert.ok(
        proactive!.barrageCount >= 3 && proactive!.barrageCount <= 5,
        `carpet should commit 3-5 beacons, got ${proactive!.barrageCount}`,
    );
    assert.ok(proactive!.reserveCount > 0, "carpet keeps a reserve");

    const counter = planBrStrobeBarrage({
        ...base,
        strobeCount: 1,
        hostilePressure: 3,
        enemyDistance: 25,
    });
    assert(counter, "hostile pressure arms a counter even with one beacon");
    assert.equal(counter!.counter, true);
    assert.equal(counter!.barrageCount, 1);
    assert.ok(counter!.rateMs < 400, "counter barrage must throw fast");

    assert.equal(
        planBrStrobeBarrage({ ...base, strobeCount: 5, hostilePressure: 0, enemyDistance: 10 }),
        null,
        "too close -> no strobe",
    );
    assert.equal(
        planBrStrobeBarrage({ ...base, strobeCount: 5, hostilePressure: 0, enemyDistance: 42 }),
        null,
        "too far -> no strobe",
    );
    assert.equal(
        planBrStrobeBarrage({
            ...base,
            strobeCount: 5,
            hostilePressure: 0,
            enemyDistance: 25,
            millisecondsSinceDamage: 100,
        }),
        null,
        "recent damage blocks a barrage",
    );
    // Duels use the same barrage rules: enough beacons -> opening barrage.
    const duelOpening = planBrStrobeBarrage({
        ...base,
        strobeCount: 4,
        hostilePressure: 0,
        enemyDistance: 25,
    });
    assert(duelOpening, "duel with enough beacons must open with a barrage");
    assert.equal(duelOpening!.counter, false);
    assert.ok(duelOpening!.barrageCount >= 3, "duel opening barrage commits 3+ beacons");

    // Forbidden/LEGIT duel counter: opening barrage arms only with enough
    // beacons; pressure keeps its existing behavior.
    assert.equal(planForbiddenCounterStrobes(5).barrageCount, 0, "no pressure, no opening by default");
    assert.equal(
        planForbiddenCounterStrobes(2, 0, false, true).barrageCount,
        0,
        "opening barrage requires enough beacons",
    );
    const openingPlan = planForbiddenCounterStrobes(6, 0, false, true);
    assert.equal(openingPlan.barrageCount, 3, "opening barrage commits up to three beacons");
    assert.equal(openingPlan.reserveCount, 3, "opening barrage keeps a reserve");
    assert.equal(openingPlan.carpet, true);
    assert.equal(planForbiddenCounterStrobes(6, 2).barrageCount, 3, "pressure counter unchanged");

    // 1v1 opening: the enemy spawns far beyond the strobe envelope. The
    // opening barrage must still throw a max-range forward strike instead of
    // refusing to "waste" a beacon (this was the observed no-carpet failure).
    const farEnemyPlan = planForbiddenStrobeCarpet({
        botPos: { x: 140, y: 68 },
        botVelocity: { x: 0, y: 0 },
        enemyPos: { x: 35, y: 68 },
        enemyVelocity: { x: 0, y: 0 },
        enemyDir: { x: 1, y: 0 },
        layer: 0,
        obstacles: [],
        mapWidth: 176,
        mapHeight: 136,
        throwIndex: 0,
        barrageCount: 3,
        existingTargets: [],
        openingBarrage: true,
    });
    assert(farEnemyPlan, "opening barrage must plan a forward strike at a far enemy");
    const forwardDistance = Math.hypot(
        farEnemyPlan!.landingPoint.x - 140,
        farEnemyPlan!.landingPoint.y - 68,
    );
    assert.ok(
        forwardDistance >= 30 && forwardDistance <= 41,
        `forward strike must be at max throw range, got ${forwardDistance.toFixed(1)}`,
    );
    assert.ok(
        farEnemyPlan!.landingPoint.x < 140,
        "forward strike must head toward the enemy side",
    );
    assert.equal(
        planForbiddenStrobeCarpet({
            botPos: { x: 140, y: 68 },
            botVelocity: { x: 0, y: 0 },
            enemyPos: { x: 35, y: 68 },
            enemyVelocity: { x: 0, y: 0 },
            enemyDir: { x: 1, y: 0 },
            layer: 0,
            obstacles: [],
            mapWidth: 176,
            mapHeight: 136,
            throwIndex: 0,
            barrageCount: 3,
            existingTargets: [],
        }),
        null,
        "without opening mode a far enemy still refuses the strike",
    );

    // --- server-side human beacon throttle ---
    const game = new Game(
        "br-strobe-throttle",
        { mapName: "main", teamMode: TeamMode.Solo },
        () => {},
        () => {},
    );
    await game.init();
    const human = join(game, "human", "human-token", "Human", 1);
    const bot = join(game, "bot", "bot-token", "Bot", 2);
    bot.serverBot = true;
    human.pos = v2.create(50, 50);
    human.posOld = v2.copy(human.pos);
    bot.pos = v2.create(80, 80);
    bot.posOld = v2.copy(bot.pos);

    let strikesAdded = 0;
    const originalAddAirStrike = game.planeBarn.addAirStrike.bind(game.planeBarn);
    game.planeBarn.addAirStrike = ((...args: Parameters<typeof originalAddAirStrike>) => {
        strikesAdded++;
        originalAddAirStrike(...args);
    }) as typeof game.planeBarn.addAirStrike;

    // Fire scheduled airstrike timeouts synchronously so the test is fast and
    // deterministic: one strobe = three lanes -> three addAirStrike calls.
    const originalSchedule = game.scheduleArenaRoundTimeout.bind(game);
    game.scheduleArenaRoundTimeout = ((callback: () => void) => {
        callback();
        return 0 as never;
    }) as typeof game.scheduleArenaRoundTimeout;

    const throwStrobe = (player: Player, x: number, y: number) => {
        const proj = game.projectileBarn.addProjectile(
            player.__id,
            "strobe",
            v2.create(x, y),
            0.5,
            player.layer,
            v2.create(0, 0),
            13.5,
            GameConfig.DamageType.Player,
        );
        proj.update(1 / 30);
        return proj;
    };

    const first = throwStrobe(human, 60, 60);
    assert(first.isStrobe, "first beacon must arm its strike");
    assert(
        human.strobeStrikeLockedUntil > 0,
        "human must be locked after the first call-in",
    );

    const second = throwStrobe(human, 62, 62);
    assert(second.isStrobe, "second beacon must still arm its internal flag");
    assert.equal(
        strikesAdded,
        3,
        `only the first beacon's three lanes must be scheduled, got ${strikesAdded}`,
    );

    // Server bots are exempt so AI can carpet-bomb back.
    const botStrobe = throwStrobe(bot, 70, 70);
    assert(botStrobe.isStrobe, "bot beacon must arm its strike");
    assert.equal(
        strikesAdded,
        6,
        `bot beacon must be scheduled despite the human lock, got ${strikesAdded}`,
    );

    // After the lock expires a human beacon works again.
    human.strobeStrikeLockedUntil = 0;
    throwStrobe(human, 64, 64);
    assert.equal(
        strikesAdded,
        9,
        `human beacon must work after the lock expires, got ${strikesAdded}`,
    );

    console.log(
        "BR strobe barrage smoke test passed: planner gates, proactive carpet, counter barrage, human call-in throttle, bot exemption.",
    );
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});
