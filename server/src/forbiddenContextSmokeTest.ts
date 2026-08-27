import assert from "assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { JoinMsg } from "../../shared/net/joinMsg.ts";
import {
    buildForbiddenContext,
    legitPlayerVisible,
} from "./bot/forbiddenServerContext.ts";
import { Game } from "./game/game.ts";

function join(game: Game, socketId: string, token: string, name: string) {
    game.addJoinToken(token, true, 1);
    const msg = new JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = name;
    const player = game.playerBarn.addPlayer(socketId, msg);
    assert(player);
    return player;
}

async function main(): Promise<void> {
    const game = new Game(
        "forbidden-context-smoke",
        {
            mapName: "duel",
            teamMode: TeamMode.Solo,
            duelWeapons: ["ak47", "mosin"],
        },
        () => {},
        () => {},
    );
    await game.init();

    const bot = join(game, "socket-bot", "token-bot", "Forbidden");
    const human = join(game, "socket-human", "token-human", "Human");
    bot.indoors = false;
    human.indoors = false;

    // Omniscient HACKER context still receives an enemy outside the active scope.
    bot.pos = { x: 12, y: 12 };
    human.pos = { x: Math.max(24, game.map.width - 12), y: Math.max(24, game.map.height - 12) };
    human.moveVel = { x: -3.5, y: 1.25 };
    human.dir = { x: -1, y: 0 };
    human.shotSlowdownTimer = 0.35;

    const omniscient = buildForbiddenContext(game, bot.__id, 7, "forbidden");
    assert.equal(omniscient.perception, "omniscient");
    assert.equal(omniscient.enemies.length, 1);
    assert.deepEqual(omniscient.enemies[0].pos, human.pos);

    bot.visibleObjects.delete(human);
    const outsideScope = buildForbiddenContext(game, bot.__id, 8, "legit");
    assert.equal(outsideScope.perception, "line-of-sight");
    assert.equal(
        outsideScope.enemies.length,
        0,
        "LEGIT must not receive a live player snapshot outside the active camera",
    );

    // Locate a genuinely open pair of points on the generated duel map.
    let foundVisiblePair = false;
    let openBotPos = { x: 0, y: 0 };
    let openHumanPos = { x: 0, y: 0 };
    for (let y = 16; y <= game.map.height - 16 && !foundVisiblePair; y += 4) {
        for (let x = 16; x <= game.map.width - 28; x += 4) {
            bot.pos = { x, y };
            human.pos = { x: x + 8, y };
            bot.visibleObjects.add(human);
            const candidate = buildForbiddenContext(game, bot.__id, 9, "legit");
            if (legitPlayerVisible(game, bot, human) && candidate.enemies[0]?.lineClearFromBot) {
                foundVisiblePair = true;
                openBotPos = { ...bot.pos };
                openHumanPos = { ...human.pos };
                break;
            }
        }
    }
    assert(foundVisiblePair, "duel map must contain one open in-client-view player pair");

    const visible = buildForbiddenContext(game, bot.__id, 9, "legit");
    assert.equal(visible.enemies.length, 1);
    assert.equal(visible.enemies[0].id, human.__id);
    assert.equal(visible.enemies[0].lineClearFromBot, true);
    assert.equal(visible.enemies[0].shotSlowdownTimer, 0.35);
    assert(visible.enemies[0].postSlowdownSpeed >= Math.hypot(-3.5, 1.25));

    // Normal clients still receive an on-screen player standing behind physical
    // cover. LEGIT must retain that snapshot so it can use the same cover,
    // fake-peek and destructible-obstacle logic as HACKER, while lineClearFromBot
    // separately prevents illegal direct fire through the obstacle.
    let foundCoveredVisiblePair = false;
    for (let y = 12; y <= game.map.height - 12 && !foundCoveredVisiblePair; y += 3) {
        for (let x = 12; x <= game.map.width - 24; x += 3) {
            bot.pos = { x, y };
            human.pos = { x: x + 10, y };
            bot.visibleObjects.add(human);
            const covered = buildForbiddenContext(game, bot.__id, 91, "legit");
            if (covered.enemies.length === 1 && !covered.enemies[0].lineClearFromBot) {
                foundCoveredVisiblePair = true;
                break;
            }
        }
    }
    assert(
        foundCoveredVisiblePair,
        "LEGIT must keep normal-client-visible players behind physical cover",
    );

    bot.pos = openBotPos;
    human.pos = openHumanPos;
    bot.visibleObjects.add(human);

    // Smoke must remove the player snapshot even though the geometric wall line is clear.
    game.smokeBarn.addSmoke(
        { x: (bot.pos.x + human.pos.x) * 0.5, y: (bot.pos.y + human.pos.y) * 0.5 },
        bot.layer,
        0,
    );
    game.smokeBarn.smokes[0].rad = 6;
    const smokeHidden = buildForbiddenContext(game, bot.__id, 10, "legit");
    assert.equal(smokeHidden.enemies.length, 0, "LEGIT must not receive players hidden by smoke");
    game.smokeBarn.smokes[0].destroy();
    game.smokeBarn.smokes.length = 0;

    game.bulletBarn.fireBullet({
        bulletType: "bullet_ak47",
        gameSourceType: "ak47",
        pos: { ...human.pos },
        dir: { x: -1, y: 0 },
        layer: human.layer,
        damageMult: 1,
        damageType: GameConfig.DamageType.Player,
        playerId: human.__id,
    });

    game.projectileBarn.addProjectile(
        human.__id,
        "frag",
        { x: human.pos.x - 1, y: human.pos.y },
        0.5,
        human.layer,
        { x: -8, y: 0 },
        2.5,
        GameConfig.DamageType.Player,
    );
    game.projectileBarn.addProjectile(
        human.__id,
        "strobe",
        { x: human.pos.x - 2, y: human.pos.y + 1 },
        0.5,
        human.layer,
        { x: -4, y: 1 },
        13.5,
        GameConfig.DamageType.Player,
    );

    const context = buildForbiddenContext(game, bot.__id, 11, "legit");
    assert.equal(context.type, "forbidden-context");
    assert.equal(context.sequence, 11);
    assert.equal(context.gameId, game.id);
    assert.equal(context.mapName, "duel");
    assert.equal(context.bot?.id, bot.__id);
    assert.equal(context.enemies.length, 1);
    assert.equal(context.bullets.length, 1, "on-screen bullets remain available for human-like dodging");
    assert(context.bullets[0].id > 0);
    assert.equal(context.bullets[0].playerId, human.__id);
    assert(context.bullets[0].speed > 0);
    assert(context.bullets[0].remainingDistance > 0);
    assert.equal(context.projectiles.length, 2);
    const strobe = context.projectiles.find((projectile) => projectile.type === "strobe");
    assert(strobe);
    assert(strobe.strikeTime > 0 && strobe.strikeTime <= 2.5);
    assert.equal(strobe.strikeDuration, 3.65);
    assert.equal(strobe.strikeRadius, 17);
    assert(Math.hypot(strobe.dir.x, strobe.dir.y) > 0.9);
    assert(context.obstacles.length > 0, "known map cover remains available to both high-budget planners");

    // 搜打撤：forbidden/LEGIT 权威敌人列表必须排除其它 AI（杜绝 AI 自相残杀），
    // 只保留真人，让所有 AI 集中追击玩家。
    {
        const extractionGame = new Game(
            "forbidden-context-extraction",
            { mapName: "extraction", teamMode: TeamMode.Solo },
            () => {},
            () => {},
        );
        await extractionGame.init();
        const addPlayer = (
            socketId: string,
            token: string,
            name: string,
            serverBot = false,
        ) => {
            extractionGame.addJoinToken(token, true, 1, 60_000, false, serverBot, undefined);
            const msg = new JoinMsg();
            msg.protocol = GameConfig.protocolVersion;
            msg.matchPriv = token;
            msg.name = name;
            const player = extractionGame.playerBarn.addPlayer(socketId, msg);
            assert(player, `${name} must join`);
            return player;
        };
        const botA = addPlayer("bot-a", "token-bot-a", "BotA", true);
        const botB = addPlayer("bot-b", "token-bot-b", "BotB", true);
        const human = addPlayer("human-e", "token-human-e", "HumanE", false);
        botA.pos = { x: 20, y: 20 };
        botB.pos = { x: 30, y: 20 };
        human.pos = { x: 40, y: 20 };
        // 让真人进入 botA 的可见对象，否则 legit 视野过滤后 enemy 为空。
        botA.visibleObjects.add(human);
        const context = buildForbiddenContext(extractionGame, botA.__id, 99, "legit");
        const enemyIds = context.enemies.map((enemy) => enemy.id);
        assert.ok(
            enemyIds.includes(human.__id),
            "extraction LEGIT context must keep the human as an enemy",
        );
        assert.ok(
            !enemyIds.includes(botB.__id),
            "extraction LEGIT context must NOT list another AI as an enemy (no friendly fire)",
        );
        extractionGame.stop();
    }

    // Outside extraction, high-tier snapshots obey real team ownership. This
    // keeps normal duo/squad/faction LEGIT bots from wasting aim and ammunition
    // on teammates after the controller is enabled outside 1v1.
    {
        const teamGame = new Game(
            "forbidden-context-team",
            { mapName: "main", teamMode: TeamMode.Duo },
            () => {},
            () => {},
        );
        await teamGame.init();
        const teamBot = join(teamGame, "team-bot", "team-token-bot", "TeamBot");
        const teammate = join(teamGame, "team-ally", "team-token-ally", "TeamAlly");
        const opponent = join(teamGame, "team-enemy", "team-token-enemy", "TeamEnemy");
        teamBot.teamId = 21;
        teammate.teamId = 21;
        opponent.teamId = 22;
        const context = buildForbiddenContext(teamGame, teamBot.__id, 101, "forbidden");
        const enemyIds = context.enemies.map((enemy) => enemy.id);
        assert.ok(!enemyIds.includes(teammate.__id), "normal team context must exclude teammates");
        assert.ok(enemyIds.includes(opponent.__id), "normal team context must retain opponents");
        teamGame.stop();
    }

    console.log(
        "Forbidden/LEGIT context smoke test passed: HACKER keeps omniscient state while LEGIT receives only normal-client-visible players, visible bullets/projectiles and map cover; extraction AI excluded from enemies.",
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
