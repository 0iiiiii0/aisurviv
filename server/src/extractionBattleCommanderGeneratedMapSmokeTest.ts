import assert from "node:assert/strict";
import { TeamMode } from "../../shared/gameConfig.ts";
import { collider } from "../../shared/utils/collider.ts";
import {
    ExtractionBattleCommander,
    type ExtractionCommanderBot,
    type ExtractionCommanderEntry,
    type ExtractionCommanderObstacle,
} from "./bot/extractionBattleCommander.ts";
import {
    FullMapPathPlanner,
    type FullMapPathObstacle,
} from "./bot/fullMapPathPlanner.ts";
import { ExtractionBattlePhase, ExtractionBattleRole } from "../../shared/net/net.ts";
import { Game } from "./game/game.ts";

const game = new Game("extraction-command-generated", {
    mapName: "extraction_secret",
    teamMode: TeamMode.Duo,
    extractionSecretEnabled: true,
});

try {
    const entries: ExtractionCommanderEntry[] = game.map.structures.flatMap((structure) =>
        structure.stairs.flatMap((stair, stairIndex) =>
            stair.lootOnly
                ? []
                : [{
                    kind: "stair" as const,
                    id: structure.__id * 16 + stairIndex,
                    pos: { ...stair.center },
                    downDir: { ...stair.downDir },
                    structureId: structure.__id,
                    stairIndex,
                    layer: structure.layer,
                }]
        )
    );
    for (const obstacle of game.map.obstacles) {
        if (
            !obstacle.isDoor
            || obstacle.dead
            || !obstacle.door?.canUse
            || obstacle.door.locked
        ) continue;
        entries.push({
            kind: "door",
            id: obstacle.__id,
            pos: { ...obstacle.pos },
            structureId: 0,
            stairIndex: 255,
            layer: obstacle.layer,
        });
    }

    const obstacles: ExtractionCommanderObstacle[] = game.map.obstacles
        .filter((obstacle) => obstacle.collidable)
        .map((obstacle) => ({
            id: obstacle.__id,
            type: obstacle.type,
            pos: { ...obstacle.pos },
            layer: obstacle.layer,
            dead: obstacle.dead,
            destructible: obstacle.destructible,
            openableDoor: Boolean(
                obstacle.isDoor
                && obstacle.door?.canUse
                && !obstacle.door.locked
            ),
            collision: obstacle.collider.type === collider.Type.Circle
                ? {
                    type: 0 as const,
                    pos: { ...obstacle.collider.pos },
                    rad: obstacle.collider.rad,
                }
                : {
                    type: 1 as const,
                    min: { ...obstacle.collider.min },
                    max: { ...obstacle.collider.max },
                },
        }));

    const isCommandClearable = (obstacle: ExtractionCommanderObstacle): boolean =>
        obstacle.destructible
        && !obstacle.dead
        && /ammo_crate|crate|box|case|locker|barrel|sandbag|wood|plank/i.test(obstacle.type)
        && !/airdrop|explosive|propane|fuel|button|door/i.test(obstacle.type);
    const topologyObstacles: FullMapPathObstacle[] = obstacles
        .filter((obstacle) => !isCommandClearable(obstacle))
        .map((obstacle) => ({
            id: obstacle.id,
            layer: obstacle.layer,
            collision: obstacle.collision,
            openableDoor: obstacle.openableDoor,
        }));
    const topology = new FullMapPathPlanner({
        width: game.map.width,
        height: game.map.height,
        obstacles: topologyObstacles,
        cellSize: 2.5,
        clearance: 1.58,
    });
    const stairEntries = entries.filter(
        (entry): entry is ExtractionCommanderEntry & { downDir: { x: number; y: number } } =>
            entry.kind === "stair" && entry.downDir !== undefined,
    );
    const undergroundPoint = (
        entry: ExtractionCommanderEntry & { downDir: { x: number; y: number } },
    ) => ({
        x: entry.pos.x + entry.downDir.x * 7.2,
        y: entry.pos.y + entry.downDir.y * 7.2,
    });
    const stairUndergroundPoints = stairEntries.map(undergroundPoint);
    const networks = stairEntries.map((anchor) => {
        const reachable = topology.reachableTargets(
            undergroundPoint(anchor),
            stairUndergroundPoints,
            1,
            90_000,
        );
        return {
            anchor,
            connected: stairEntries.filter((_, index) => reachable[index]),
        };
    }).sort((a, b) => b.connected.length - a.connected.length);
    const targetNetwork = networks[0];
    assert.ok(
        targetNetwork && targetNetwork.connected.length >= 2,
        "the generated extraction map must contain a genuinely connected multi-entry bunker",
    );
    const targetStructure = game.map.structures.find(
        (structure) => structure.__id === targetNetwork.anchor.structureId,
    );
    assert.ok(targetStructure);
    const initialUnderground = undergroundPoint(targetNetwork.anchor);
    const humanOneCell = topology.plan(
        initialUnderground,
        initialUnderground,
        1,
        90_000,
    );
    assert.ok(humanOneCell, "the first duo player must resolve to a bunker walkable cell");
    const humanTwoPos = [
        { x: 0.8, y: 0 },
        { x: -0.8, y: 0 },
        { x: 0, y: 0.8 },
        { x: 0, y: -0.8 },
    ].map((offset) => ({
        x: humanOneCell.resolvedStart.x + offset.x,
        y: humanOneCell.resolvedStart.y + offset.y,
    })).find((candidate) => topology.isSegmentClear(humanOneCell.resolvedStart, candidate, 1))
        ?? humanOneCell.resolvedStart;
    const humans = [
        { id: 5_001, pos: { ...humanOneCell.resolvedStart }, layer: 1 },
        { id: 5_002, pos: { ...humanTwoPos }, layer: 1 },
    ];

    const bots: ExtractionCommanderBot[] = Array.from({ length: 12 }, (_, index) => {
        const angle = index / 12 * Math.PI * 2;
        return {
            id: index + 1,
            pos: {
                x: game.map.width * 0.5 + Math.cos(angle) * game.map.width * 0.36,
                y: game.map.height * 0.5 + Math.sin(angle) * game.map.height * 0.36,
            },
            layer: 0,
            health: 100,
            hasGun: true,
        };
    });
    const assaultBotIds = new Set(bots.slice(0, 6).map((bot) => bot.id));
    const frame = (timestamp: number, frameBots: ExtractionCommanderBot[]) => ({
        timestamp,
        bots: frameBots,
        humans,
        assaultBotIds,
        entries,
        obstacles,
        mapWidth: game.map.width,
        mapHeight: game.map.height,
    });

    const commander = new ExtractionBattleCommander();
    const assemble = commander.update(frame(0, bots));
    assert.equal(assemble.length, bots.length, "every same-faction AI must receive one order");
    assert.ok(assemble.every((order) => order.active));
    assert.ok(assemble.every((order) => order.phase === ExtractionBattlePhase.Assemble));
    const groupSizes = humans.map((human) =>
        assemble.filter((order) => order.targetHumanId === human.id).length
    );
    assert.ok(
        Math.max(...groupSizes) - Math.min(...groupSizes) <= 1,
        `duo warzones must share the faction force evenly: ${groupSizes.join("/")}`,
    );

    for (const human of humans) {
        const orders = assemble.filter((order) => order.targetHumanId === human.id);
        const entranceKeys = new Set(
            orders.map((order) => `${order.entryStructureId}:${order.entryStairIndex}`),
        );
        const connectedMask = topology.reachableTargets(
            human.pos,
            stairUndergroundPoints,
            1,
            90_000,
        );
        const independentlyConnected = stairEntries
            .filter((_, index) => connectedMask[index])
            .map((entry) => `${entry.structureId}:${entry.stairIndex}`);
        assert.ok(
            entranceKeys.size >= 2,
            `warzone ${human.id} must use at least two connected bunker entrances: `
                + `assigned=${[...entranceKeys].join(",")}, `
                + `connected=${independentlyConnected.join(",")}, `
                + `target=${targetStructure.type}`,
        );
        assert.ok(orders.some((order) => order.role === ExtractionBattleRole.Suppressor));
        assert.ok(orders.some((order) => order.role === ExtractionBattleRole.Breacher));
        assert.ok(orders.some((order) => order.role === ExtractionBattleRole.Flanker));
        assert.ok(orders.some((order) => order.role === ExtractionBattleRole.Clearer));
        for (const order of orders) {
            const entry = entries.find((candidate) =>
                candidate.structureId === order.entryStructureId
                && candidate.stairIndex === order.entryStairIndex
            );
            assert.ok(entry?.downDir, "underground orders must reference an actual generated stair");
            const inside = {
                x: entry.pos.x + entry.downDir.x * 7.2,
                y: entry.pos.y + entry.downDir.y * 7.2,
            };
            assert.ok(
                topology.plan(inside, human.pos, 1, 90_000),
                `stair ${order.entryStructureId}:${order.entryStairIndex} must lead to its assigned human`,
            );
        }
    }

    const claimedBlockers = assemble
        .map((order) => order.clearObstacleId)
        .filter((id) => id !== 0);
    assert.equal(
        new Set(claimedBlockers).size,
        claimedBlockers.length,
        "the match commander must not assign one ammo box to multiple clearers",
    );

    const stagedBots = bots.map((bot) => {
        const order = assemble.find((candidate) => candidate.botId === bot.id)!;
        return {
            ...bot,
            pos: { x: order.objectiveX, y: order.objectiveY },
            layer: order.objectiveLayer,
        };
    });
    const suppress = commander.update(frame(1_200, stagedBots));
    assert.ok(
        suppress.every((order) => order.phase === ExtractionBattlePhase.Suppress),
        "both duo warzones must enter synchronized suppression",
    );
    const damagedBots = stagedBots.map((bot, index) => ({
        ...bot,
        health: index === 0 ? 60 : bot.health,
    }));
    const breach = commander.update(frame(1_750, damagedBots));
    assert.ok(
        breach.every((order) => order.phase === ExtractionBattlePhase.Breach),
        "damage in one warzone must trigger a match-wide breach response",
    );
    assert.equal(
        breach.find((order) => order.botId === damagedBots[0].id)?.underFireResponse,
        true,
    );

    // Exercise the production ExtractionSystem collector as well: its player,
    // stair, door and obstacle snapshots must feed the same central commander.
    const liveHumans = humans.map((human, index) => {
        const player = game.playerBarn.addTestPlayer({
            name: `CommandHuman${index + 1}`,
            pos: { ...human.pos },
        });
        player.layer = human.layer;
        return player;
    });
    const liveBots = bots.map((bot, index) => {
        const player = game.playerBarn.addTestPlayer({
            name: `CommandBot${index + 1}`,
            pos: { ...bot.pos },
        });
        player.serverBot = true;
        player.layer = bot.layer;
        return player;
    });
    const extraction = game.extraction() as unknown as {
        hunterBotIds: number[];
        battleOrders: Array<{
            botId: number;
            targetHumanId: number;
            active: boolean;
            clearObstacleId: number;
        }>;
        refreshHunters(): void;
        refreshBattleOrders(): void;
        isBattleClearAuthorized(botId: number, obstacleId: number): boolean;
    };
    extraction.refreshHunters();
    extraction.refreshBattleOrders();
    assert.equal(
        extraction.battleOrders.length,
        liveBots.length,
        "the production extraction system must issue one command to every regular AI",
    );
    assert.deepEqual(
        new Set(extraction.battleOrders.map((order) => order.botId)),
        new Set(liveBots.map((bot) => bot.__id)),
    );
    assert.deepEqual(
        new Set(extraction.battleOrders.map((order) => order.targetHumanId)),
        new Set(liveHumans.map((human) => human.__id)),
    );
    assert.ok(extraction.battleOrders.every((order) => order.active));
    const authorizationProbe = extraction.battleOrders[0];
    extraction.battleOrders = [{ ...authorizationProbe, clearObstacleId: 65_000 }];
    assert.equal(
        extraction.isBattleClearAuthorized(authorizationProbe.botId, 65_000),
        true,
        "the assigned clearer must receive armor-plated obstacle permission",
    );
    assert.equal(
        extraction.isBattleClearAuthorized(liveBots.at(-1)!.__id, 65_000),
        false,
        "another faction member must not inherit the clearer permission",
    );

    console.log(
        "Generated secret-duo commander smoke test passed: "
            + `map=${game.map.width}x${game.map.height}, obstacles=${obstacles.length}, `
            + `bunker=${targetStructure.type}, entries=${targetNetwork.connected.length}, `
            + `groups=${groupSizes.join("/")}, clearClaims=${claimedBlockers.length}.`,
    );
} finally {
    game.stop();
}
