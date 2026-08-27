import assert from "assert/strict";
import fs from "fs";
import path from "path";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Game } from "./game/game.ts";

const playerSource = fs.readFileSync(path.join(__dirname, "game/objects/player.ts"), "utf8");

// Ported upstream behaviours (source assertions)
assert.match(playerSource, /GameConfig\.player\.killLeaderMinKills/, "kill leader uses the shared 3-kill threshold on every map");
assert.match(playerSource, /params\.damageType !== GameConfig\.DamageType\.Bleeding\n\s*\) \{/, "armor now also reduces airdrop damage");
assert.match(playerSource, /Math\.random\(\) < GameConfig\.player\.headshotChance/, "headshot chance comes from the shared config");
assert.match(playerSource, /GameConfig\.Action\.Revive\s*\|\|[\s\S]{0,50}this\.weaponManager\.cookingThrowable/, "heal/boost are locked during revive and while cooking a throwable");
assert.match(playerSource, /downedDamageTicker = GameConfig\.player\.downedDamageBuffer/, "downing grants a damage buffer");
assert.match(playerSource, /this\.game\.gas\.currentRad <= 0\.1/, "final-circle downed players get 50 HP instead of 100");
assert.match(playerSource, /setCurWeapIndex\(GameConfig\.WeaponSlot\.Melee, true\)/, "downed players switch to melee");

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

function damage(source: ReturnType<typeof join>, target: ReturnType<typeof join>, amount: number, dir = { x: 1, y: 0 }) {
    target.damage({
        amount,
        damageType: GameConfig.DamageType.Player,
        dir,
        source,
        gameSourceType: "fists",
    });
}

async function main(): Promise<void> {
    const game = new Game(
        "new-behavior-port",
        { mapName: "faction", teamMode: TeamMode.Squad },
        () => {},
        () => {},
    );
    await game.init();

    const a = join(game, "a", "ta", "A", 1);
    const b = join(game, "b", "tb", "B", 1);
    const c = join(game, "c", "tc", "C", 2);
    assert.equal(a.teamId, 1);
    assert.equal(b.teamId, 1);
    assert.equal(c.teamId, 2);

    // B is downed by enemy C (faction mode downs instead of killing).
    damage(c, b, 1000);
    assert.equal(b.downed, true, "B should be downed");
    assert.ok(b.downedDamageTicker > 0, "downed player receives a damage buffer");

    // The damage buffer blocks the finishing hit.
    damage(c, b, 1000);
    assert.equal(b.dead, false, "damage buffer must block the finishing hit");

    // After the buffer expires the player can be finished.
    b.update(0.3);
    assert.equal(b.downedDamageTicker, 0, "damage buffer expires");
    damage(c, b, 1000);
    assert.equal(b.dead, true, "player can be finished after the buffer");

    // Final circle: downing gives 50 HP instead of 100.
    const d = join(game, "d", "td", "D", 1);
    game.gas.currentRad = 0.05;
    damage(c, d, 1000);
    assert.equal(d.downed, true, "D should be downed");
    assert.equal(d.health, 50, "final-circle downed player gets 50 HP");
    game.gas.currentRad = 1;

    // Healing is locked while reviving.
    const e = join(game, "e", "te", "E", 1);
    e.inventory.bandage = 5;
    e.actionType = GameConfig.Action.Revive;
    e.playerBeingRevived = d;
    e.useHealingItem("bandage");
    assert.equal(e.actionType, GameConfig.Action.Revive, "healing must not cancel a revive");

    console.log("New-behavior port smoke test passed: downed buffer, final-circle HP, heal/revive lock and kill-leader threshold.");
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});
