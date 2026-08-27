import assert from "assert/strict";
import fs from "fs";
import { BitStream } from "../../shared/net/net.ts";
import { deserializePlayerInfo, serializePlayerInfo, type PlayerInfo } from "../../shared/net/updateMsg.ts";
import { FactionCoordinator } from "./bot/factionStrategy.ts";
import {
    detectHumanPush,
    humanSupportPoint,
    shouldDisbandSupport,
    shouldEscortHuman,
} from "./bot/humanSupport.ts";
import { IntentTier, TacticalDecisionBrain } from "./bot/decisionBrain.ts";
import path from "path";
import type { MapRuntimeSnapshot } from "./bot/mapStrategy.ts";

const snapshot: MapRuntimeSnapshot = {
    mapName: "faction",
    seed: 7,
    width: 1200,
    height: 1200,
    shoreInset: 24,
    grassInset: 10,
    rivers: [],
    places: [],
    objects: [],
    groundPatches: [],
};

const freshCoord = () => {
    const coord = new FactionCoordinator({ enabled: true });
    coord.loadMap(snapshot);
    return coord;
};

const member = (botId: number, pos: { x: number; y: number }, role: "leader" | "assault" | "support" | "scout" = "assault") => ({
    botId,
    playerId: 100 + botId,
    teamId: 1,
    squadId: 1,
    squadSlot: botId % 4,
    role,
    doctrine: "line" as const,
    pos,
    dir: { x: 1, y: 0 },
    health: 100,
    boost: 50,
    downed: false,
    dead: false,
    underFire: false,
    state: "regroup",
    enemyTargetId: 0,
    enemyDistance: Infinity,
    updatedAt: 1000,
    specialRole: undefined,
});

const enemyReport = (targetId: number, pos: { x: number; y: number }, reporterBotId = 1, distance = 120, updatedAt = 1000) => ({
    reporterBotId,
    reporterTeamId: 1,
    targetId,
    pos,
    score: 50,
    distance,
    visible: true,
    downed: false,
    updatedAt,
});

// 1) Wire round-trip: the bot learns which teammates are humans via PlayerInfo.
{
    const source: PlayerInfo = {
        playerId: 42,
        teamId: 1,
        groupId: 7,
        name: "HumanPilot",
        isBot: false,
        loadout: { heal: "heal_basic", boost: "boost_basic" },
    };
    const stream = new BitStream(new ArrayBuffer(128));
    serializePlayerInfo(stream, source);
    stream.index = 0;
    const restored = {} as PlayerInfo;
    deserializePlayerInfo(stream, restored);
    assert.equal(restored.isBot, false, "human player must be marked isBot=false");
    assert.equal(restored.name, "HumanPilot");
    const botInfo: PlayerInfo = { ...source, name: "AI-normal", isBot: true };
    stream.index = 0;
    serializePlayerInfo(stream, botInfo);
    stream.index = 0;
    deserializePlayerInfo(stream, restored);
    assert.equal(restored.isBot, true, "bot player must be marked isBot=true");
}

// 2) Unified attack: a healthy attacking faction issues one shared push order
// for every doctrine (no scattered lanes).
{
    const coord = freshCoord();
    for (let botId = 1; botId <= 6; botId++) {
        coord.updateBot(member(botId, { x: 500 + botId * 4, y: 600 }));
    }
    for (let i = 1; i <= 3; i++) {
        coord.reportEnemy(enemyReport(200 + i, { x: 700, y: 640 }, 1, 150));
    }
    const orders = [1, 2, 3, 4, 5, 6].map((botId) =>
        coord.getOrder({
            botId,
            teamId: 1,
            pos: { x: 500 + botId * 4, y: 600 },
            health: 100,
            phase: "early",
            gasCenter: null,
            gasRadius: null,
            timestamp: 1050,
        }),
    );
    for (const order of orders) {
        assert.ok(order, "order must be produced");
        assert.equal(order.unifiedPush, true, "healthy attacking faction must issue a unified push");
        assert.notEqual(order.stance, "withdraw");
    }
    const objectives = orders.map((order) => order!.objective);
    let maxSpread = 0;
    for (let i = 0; i < objectives.length; i++) {
        for (let j = i + 1; j < objectives.length; j++) {
            const spread = Math.hypot(objectives[i].x - objectives[j].x, objectives[i].y - objectives[j].y);
            maxSpread = Math.max(maxSpread, spread);
        }
    }
    assert.ok(maxSpread < 80, `unified push must keep the formation tight, spread=${maxSpread.toFixed(1)}`);
}

// 3) Under heavy pressure the faction stops the unified push and falls back.
{
    const coord = freshCoord();
    for (let botId = 1; botId <= 6; botId++) {
        coord.updateBot(member(botId, { x: 500 + botId * 4, y: 600 }));
    }
    for (let i = 1; i <= 4; i++) {
        coord.reportEnemy(enemyReport(300 + i, { x: 505, y: 605 }, 1, 14, 1050));
    }
    const order = coord.getOrder({
        botId: 1,
        teamId: 1,
        pos: { x: 504, y: 600 },
        health: 100,
        phase: "early",
        gasCenter: null,
        gasRadius: null,
        timestamp: 1100,
    });
    assert.ok(order, "order must be produced under pressure");
    assert.equal(order.unifiedPush, false, "pressure must cancel the unified push");
}

// 4) Faction rescue prefers a downed human teammate over a downed bot.
{
    const coord = freshCoord();
    for (let botId = 1; botId <= 3; botId++) {
        coord.updateBot(member(botId, { x: 300 + botId * 5, y: 300 }));
    }
    coord.updateBot({ ...member(1, { x: 340, y: 310 }), role: "support", specialRole: "medic" } as never);
    coord.reportDowned(
        [
            {
                playerId: 900,
                teamId: 1,
                pos: { x: 360, y: 320 },
                outsideGas: false,
                enemyDistance: 90,
                updatedAt: 1000,
                human: false,
            },
            {
                playerId: 901,
                teamId: 1,
                pos: { x: 330, y: 290 },
                outsideGas: false,
                enemyDistance: 95,
                updatedAt: 1000,
                human: true,
            },
        ],
        1000,
    );
    const rescueOrder = coord.getOrder({
        botId: 1,
        teamId: 1,
        pos: { x: 340, y: 310 },
        health: 100,
        phase: "early",
        gasCenter: null,
        gasRadius: null,
        timestamp: 1050,
    });
    assert.ok(rescueOrder, "rescue order must be produced");
    assert.equal(rescueOrder.stance, "rescue");
    assert.equal(rescueOrder.rescuePlayerId, 901, "the human teammate must win the rescue");
}


// 5) Source guarantees for the bot-side cooperation wiring.
const smartBotSource = fs.readFileSync(path.join(__dirname, "smartBot.ts"), "utf8") + "\n" + fs.readFileSync(path.join(__dirname, "bot", "smartBotSupport.ts"), "utf8");
assert.match(smartBotSource, /human: this\.playerInfos\.get\(object\.__id\)\?\s*\.isBot === false/, "downed reports must carry the human flag");
assert.match(smartBotSource, /\(a\.human \? 160 : 0\)/, "squad rescue must rank humans first");
assert.match(smartBotSource, /rescue\.human \? "revive-human-teammate" : "assigned-revive"/, "human rescues must get a dedicated intent");
assert.match(smartBotSource, /unifiedFocusBonus/, "unified attack must boost the shared focus target");
assert.match(smartBotSource, /const factionOrder = this\.getFactionOrder\(myPos, timestamp\);\n\s*this\.currentFactionOrder = factionOrder;\n\s*const enemy = this\.chooseEnemy/, "the faction order must be resolved before target selection");
const factionSource = fs.readFileSync(path.join(__dirname, "bot", "factionStrategy.ts"), "utf8");
assert.match(factionSource, /unifiedPush/, "the faction order must carry the unified push flag");
assert.match(factionSource, /\(b\.human\) - Number\(a\.human\)/, "faction rescue must sort humans first");

// 6) Human push detection: forward-moving human ahead of the bot pushes.
{
    const base = {
        botId: 3,
        teamId: 1,
        botPos: { x: 500, y: 600 },
        humanId: 901,
        humanPos: { x: 620, y: 620 },
        humanVelocity: { x: 40, y: 10 },
        homeAnchor: { x: 400, y: 600 },
        mapCenter: { x: 600, y: 600 },
        humanUnderFire: false,
        humanDowned: false,
        humanDead: false,
        timestamp: 2000,
    };
    const pushing = detectHumanPush(base);
    assert.equal(pushing.pushing, true, "forward-moving human ahead of the bot must count as pushing");
    // Stationary at the rear: not pushing.
    const idle = detectHumanPush({ ...base, humanPos: { x: 420, y: 600 }, humanVelocity: { x: 0, y: 0 } });
    assert.equal(idle.pushing, false, "rear idle human must not count as pushing");
    // Stationary ahead but under fire: pushing (holding a fight).
    const fighting = detectHumanPush({ ...base, humanVelocity: { x: 0, y: 0 }, humanUnderFire: true });
    assert.equal(fighting.pushing, true, "stationary human ahead under fire must count as pushing");
    // Downed: not pushing.
    const downed = detectHumanPush({ ...base, humanDowned: true });
    assert.equal(downed.pushing, false, "downed human must not push");
}

// 7) Deterministic escort assignment: a stable subset of equipped bots.
{
    const matched = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((botId) =>
        shouldEscortHuman({ botId, teamId: 1, humanId: 901, share: 4 }),
    );
    assert.ok(matched.length >= 1 && matched.length <= 4, `escort share must select a portion, got ${matched.length}`);
    assert.equal(
        shouldEscortHuman({ botId: 3, teamId: 1, humanId: 901, share: 4 }),
        shouldEscortHuman({ botId: 3, teamId: 1, humanId: 901, share: 4 }),
        "assignment must be deterministic",
    );
}

// 8) Support point sits behind the human on the friendly side, inside bounds.
{
    const point = humanSupportPoint({
        humanPos: { x: 620, y: 620 },
        pushDirection: { x: 0.707, y: 0.707 },
        botId: 5,
        mapWidth: 1200,
        mapHeight: 1200,
    });
    assert.ok(point.x > 2 && point.x < 1198 && point.y > 2 && point.y < 1198, "support point must be inside the map");
    const behind = (point.x - 620) * 0.707 + (point.y - 620) * 0.707;
    assert.ok(behind < -6, `support point must sit behind the human, depth=${behind.toFixed(1)}`);
}

// 9) Escort disbands on death / too far / push stall.
{
    assert.equal(
        shouldDisbandSupport({ pushing: true, humanDead: true, humanDowned: false, distanceToHuman: 20, pushLatchMs: 7000, lastPushAt: 1000, timestamp: 3000 }),
        true,
        "dead human ends the escort",
    );
    assert.equal(
        shouldDisbandSupport({ pushing: false, humanDead: false, humanDowned: false, distanceToHuman: 450, pushLatchMs: 7000, lastPushAt: 1000, timestamp: 3000 }),
        true,
        "human too far ends the escort",
    );
    assert.equal(
        shouldDisbandSupport({ pushing: false, humanDead: false, humanDowned: false, distanceToHuman: 250, pushLatchMs: 7000, lastPushAt: 1000, timestamp: 3000 }),
        false,
        "a mid-range gap must let the squad keep catching up",
    );
    assert.equal(
        shouldDisbandSupport({ pushing: false, humanDead: false, humanDowned: false, distanceToHuman: 260, pushLatchMs: 7000, lastPushAt: 1000, timestamp: 13000, startedAt: 1000, startDistance: 300 }),
        true,
        "a chase that made no progress after 12s must give up",
    );
    assert.equal(
        shouldDisbandSupport({ pushing: false, humanDead: false, humanDowned: false, distanceToHuman: 20, pushLatchMs: 7000, lastPushAt: 1000, timestamp: 2000 }),
        false,
        "short push stall keeps the escort",
    );
}

// 9b) Distance-limited deterministic assignment: far bots do not volunteer.
{
    assert.equal(
        shouldEscortHuman({ botId: 3, teamId: 1, humanId: 901, share: 4, distanceToHuman: 200 }),
        shouldEscortHuman({ botId: 3, teamId: 1, humanId: 901, share: 4, distanceToHuman: 200 }),
        "distance filtering must stay deterministic",
    );
    const farMatched = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((botId) =>
        shouldEscortHuman({ botId, teamId: 1, humanId: 901, share: 4, distanceToHuman: 500, maxDistance: 360 }),
    );
    assert.equal(farMatched.length, 0, "bots beyond maxDistance must not volunteer");
}

// 10) Source guarantees for the human-escort wiring.
{
    assert.match(smartBotSource, /human_support_started/, "the bot must record escort start");
    assert.match(smartBotSource, /followHumanSupport\(/, "the bot must implement the escort movement");
    assert.match(smartBotSource, /shouldEscortHuman\(\{/, "the bot must use the deterministic assignment");
    const brainSource = fs.readFileSync(path.join(__dirname, "bot", "decisionBrain.ts"), "utf8");
    assert.match(brainSource, /"human-escort"/, "the decision brain must know the escort intent");
}

// 10b) Rescue must not be skipped: downed teammates stay visible to server
// bots (a downed human at the camera edge used to flicker in and out, so the
// rescue assignment toggled every tick and nobody committed), and human
// rescues are emergency priority with a wider reach.
{
    const playerSource = fs.readFileSync(
        path.join(__dirname, "game", "objects", "player.ts"),
        "utf8",
    );
    assert.doesNotMatch(
        playerSource,
        /teammate\.dead \|\|\s*teammate\.downed/,
        "downed teammates must not be excluded from the bot visibility stream",
    );
    assert.match(
        smartBotSource,
        /rescue\.human \? IntentTier\.emergency : IntentTier\.support/,
        "human rescue must be emergency priority (beats urgent crate/loot)",
    );
    assert.match(
        smartBotSource,
        /const humanRescueRange = rescue\.human \? 55 : 30;/,
        "human rescue reach must extend to 55m",
    );
}

// 11) Deterministic arbitration: a close escort beats loose loot and generic
// formation, while combat still wins over it.
{
    const brain = new TacticalDecisionBrain({});
    const strategic = { tier: IntentTier.strategic, commitMs: 500 };
    const decision = brain.choose(
        [
            {
                ...strategic,
                kind: "formation",
                state: "regroup",
                utility: 640,
                targetKey: "formation:squad",
                reason: "squad-too-far",
            },
            {
                ...strategic,
                kind: "loot",
                state: "loot",
                utility: 590,
                targetKey: "loot:1",
                reason: "valuable-nearby-loot",
            },
            {
                ...strategic,
                kind: "human-escort",
                state: "regroup",
                utility: 655,
                targetKey: "human-escort:901",
                reason: "escort-pushing-human",
            },
            {
                tier: IntentTier.combat,
                commitMs: 500,
                kind: "combat",
                state: "combat",
                utility: 760,
                targetKey: "enemy:5",
                reason: "visible-enemy",
            },
        ],
        1000,
    );
    assert.equal(
        decision.kind,
        "combat",
        "combat must beat the escort when an enemy is visible",
    );
    brain.reset();
    const withoutCombat = brain.choose(
        [
            {
                ...strategic,
                kind: "formation",
                state: "regroup",
                utility: 640,
                targetKey: "formation:squad",
                reason: "squad-too-far",
            },
            {
                ...strategic,
                kind: "human-escort",
                state: "regroup",
                utility: 655,
                targetKey: "human-escort:901",
                reason: "escort-pushing-human",
            },
        ],
        2000,
    );
    assert.equal(
        withoutCombat.kind,
        "human-escort",
        "escort must beat generic formation/loot when no enemy is visible",
    );
}

// 11b) With the real tiers used by the bot, escort (support) must beat normal
// loot and weapon-search, but still lose to combat and healing.
{
    const brain = new TacticalDecisionBrain({});
    const decision = brain.choose(
        [
            {
                tier: IntentTier.resource,
                commitMs: 760,
                kind: "loot",
                state: "loot",
                utility: 900,
                targetKey: "loot:1",
                reason: "valuable-nearby-loot",
            },
            {
                tier: IntentTier.resource,
                commitMs: 1650,
                kind: "weapon-search",
                state: "explore",
                utility: 800,
                targetKey: "weapon-search:1:1",
                reason: "find-firearm-or-ammo",
            },
            {
                tier: IntentTier.support,
                commitMs: 900,
                kind: "human-escort",
                state: "regroup",
                utility: 655,
                targetKey: "human-escort:901",
                reason: "escort-pushing-human",
            },
        ],
        1000,
    );
    assert.equal(
        decision.kind,
        "human-escort",
        "escort must beat real loot/weapon-search tiers",
    );
    brain.reset();
    const healWins = brain.choose(
        [
            {
                tier: IntentTier.support,
                commitMs: 900,
                kind: "human-escort",
                state: "regroup",
                utility: 655,
                targetKey: "human-escort:901",
                reason: "escort-pushing-human",
            },
            {
                tier: IntentTier.emergency,
                commitMs: 650,
                kind: "heal-in-cover",
                state: "retreat",
                utility: 850,
                targetKey: "heal-cover:1:1",
                reason: "medicine-unsafe",
            },
        ],
        2000,
    );
    assert.equal(
        healWins.kind,
        "heal-in-cover",
        "healing must still beat the escort",
    );
}

console.log("Cooperation smoke test passed: unified attack push, focus fire and human-first rescue.");
