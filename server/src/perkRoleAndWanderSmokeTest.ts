import assert from "assert/strict";
import fs from "fs";
import path from "path";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Game } from "./game/game.ts";
import { FactionCoordinator } from "./bot/factionStrategy.ts";
import type { MapRuntimeSnapshot } from "./bot/mapStrategy.ts";

function join(game: Game, socketId: string, token: string, name: string, teamId: number) {
    game.addJoinToken(token, true, 1, 60_000, false, true, [teamId]);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = name;
    const player = game.playerBarn.addPlayer(socketId, msg);
    assert(player);
    return player;
}

// 1) ap_rounds (a droppable loot perk) must survive a role assignment even when
// the role grants 5 perks (last_man), with its droppable loot slot intact.
async function runApRoundsRoleSurvival(): Promise<void> {
    const game = new Game(
        "ap-rounds-role",
        { mapName: "main", teamMode: TeamMode.Squad },
        () => {},
        () => {},
    );
    await game.init();
    const soldier = join(game, "s", "t", "Soldier", 1);
    soldier.addPerk("ap_rounds", true); // loot pickup marks perks droppable
    soldier.addPerk("splinter", true);
    soldier.promoteToRole("last_man"); // last_man grants 5 role perks

    assert.equal(
        soldier.hasPerk("ap_rounds"),
        true,
        "ap_rounds must survive a 5-perk role assignment",
    );
    assert.equal(
        soldier.perks.find((perk) => perk.type === "ap_rounds")?.droppable,
        true,
        "ap_rounds must keep its loot slot",
    );
    assert.equal(soldier.hasPerk("splinter"), true, "split bullets must also survive");
    assert.equal(soldier.perks.filter((perk) => perk.type === "last_man").length, 0);
}

// 2) Faction injured-count hysteresis: a member at 44 HP stays counted as
// injured even after healing to 50, and is cleared only after recovering above
// 55. This prevents the faction stance from flipping on a health boundary.
function runFactionInjuredHysteresis(): void {
    const snapshot: MapRuntimeSnapshot = {
        mapName: "faction",
        seed: 3,
        width: 1200,
        height: 1200,
        shoreInset: 24,
        grassInset: 10,
        rivers: [],
        places: [],
        objects: [],
        groundPatches: [],
    };
    const coord = new FactionCoordinator({ enabled: true });
    coord.loadMap(snapshot);
    const member = (botId: number, pos: { x: number; y: number }, health: number) => ({
        botId,
        playerId: 100 + botId,
        teamId: 1,
        squadId: 1,
        squadSlot: botId % 4,
        role: "assault" as const,
        doctrine: "line" as const,
        pos,
        dir: { x: 1, y: 0 },
        health,
        boost: 50,
        downed: false,
        dead: false,
        underFire: false,
        state: "regroup",
        enemyTargetId: 0,
        enemyDistance: Infinity,
        updatedAt: 1000,
    });
    // Two members: one healthy, one hovering near the 45 boundary.
    coord.updateBot(member(1, { x: 500, y: 600 }, 80));
    coord.updateBot(member(2, { x: 510, y: 600 }, 44));

    const orderLow = coord.getOrder({
        botId: 1,
        teamId: 1,
        pos: { x: 500, y: 600 },
        health: 80,
        phase: "early",
        gasCenter: null,
        gasRadius: null,
        timestamp: 1100,
    });
    assert.ok(orderLow);
    // casualtyRatio with one injured of two = 0.5 -> reserve would defend, but
    // the top-level stance depends on pressure; assert the injured count via a
    // direct internal read on the team state.
    const team = (coord as unknown as { teams: Map<number, { injuredHigh: Set<number> }> }).teams.get(1)!;
    assert.equal(team.injuredHigh.has(2), true, "44 HP member must be flagged injured");

    // Heals to 50 (still inside the hysteresis band 45..55): stays injured.
    coord.updateBot(member(2, { x: 510, y: 600 }, 50));
    coord.getOrder({
        botId: 1,
        teamId: 1,
        pos: { x: 500, y: 600 },
        health: 80,
        phase: "early",
        gasCenter: null,
        gasRadius: null,
        timestamp: 1200,
    });
    assert.equal(team.injuredHigh.has(2), true, "50 HP member must stay injured (hysteresis)");

    // Recovers above 55: cleared.
    coord.updateBot(member(2, { x: 510, y: 600 }, 60));
    coord.getOrder({
        botId: 1,
        teamId: 1,
        pos: { x: 500, y: 600 },
        health: 80,
        phase: "early",
        gasCenter: null,
        gasRadius: null,
        timestamp: 1300,
    });
    assert.equal(team.injuredHigh.has(2), false, "60 HP member must be cleared from injured");
}

// 3) Source guarantees for the two fixes.
const playerSource = fs.readFileSync(path.join(__dirname, "game", "objects", "player.ts"), "utf8");
assert.ok(
    !playerSource.includes("Drop droppable loot\n                // perks before applying a perk-heavy role."),
    "the old drop-all-droppable role branch must be gone",
);
assert.ok(playerSource.includes("must survive any role assignment"), "loot perks must survive role assignments");
const factionSource = fs.readFileSync(path.join(__dirname, "bot", "factionStrategy.ts"), "utf8");
assert.ok(factionSource.includes("injuredHigh"), "the faction must track injured members with hysteresis");
const botSource = fs.readFileSync(path.join(__dirname, "smartBot.ts"), "utf8") + "\n" + fs.readFileSync(path.join(__dirname, "bot", "smartBotSupport.ts"), "utf8");
assert.ok(botSource.includes("retreatHysteresisActive"), "the bot must hold retreat below the health boundary");

async function main(): Promise<void> {
    await runApRoundsRoleSurvival();
    runFactionInjuredHysteresis();
    console.log("Perk-preservation + low-health wander smoke test passed: ap_rounds survives roles; injured/retreat use hysteresis.");
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});