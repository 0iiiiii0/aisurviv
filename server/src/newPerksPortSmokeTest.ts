import assert from "assert/strict";
import fs from "fs";
import path from "path";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { Game } from "./game/game.ts";

const perkSource = fs.readFileSync(path.join(import.meta.dirname, "..", "..", "shared/defs/gameObjects/perkDefs.ts"), "utf8");
const playerSource = fs.readFileSync(path.join(import.meta.dirname, "game/objects/player.ts"), "utf8");
const bulletSource = fs.readFileSync(path.join(import.meta.dirname, "game/objects/bullet.ts"), "utf8");

// Source assertions for the ported perks
assert.match(perkSource, /lifeline: \{[\s\S]{0,180}conversionRate: 2/, "lifeline perk properties exist");
assert.match(perkSource, /combat_stims: \{[\s\S]{0,180}healPercent: 0\.06/, "combat_stims perk properties exist");
assert.match(perkSource, /ap_rounds: \{[\s\S]{0,180}armorPenetration: 0\.8/, "ap_rounds perk properties exist");
assert.match(playerSource, /hasPerk\("lifeline"\)[\s\S]{0,400}conversionRate/, "lifeline last-stand mitigation is wired in damage()");
assert.match(playerSource, /_combatStimsTicker > 0[\s\S]{0,300}healPercent/, "combat_stims friendly healing is wired");
assert.match(
    playerSource,
    /params\.armorPenetration !== undefined[\s\S]{0,100}multi \*= params\.armorPenetration/,
    "armor penetration is applied to damage reductions",
);
assert.match(bulletSource, /PerkProperties\.ap_rounds\.obstacleMult/, "ap_rounds boosts obstacle damage");
assert.match(bulletSource, /PerkProperties\.ap_rounds\.armorPenetration/, "ap_rounds carries armor penetration into bullet damage");

function join(game: Game, name: string, teamId: number) {
    const player = game.playerBarn.addTestPlayer({ name });
    player.teamId = teamId;
    player.groupId = teamId;
    return player;
}

function hurt(source: ReturnType<typeof join>, target: ReturnType<typeof join>, amount: number, gameSourceType = "fists") {
    target.damage({
        amount,
        damageType: GameConfig.DamageType.Player,
        dir: { x: 1, y: 0 },
        source,
        gameSourceType,
    });
}

async function main(): Promise<void> {
    const game = new Game("new-perks-port", { mapName: "main", teamMode: TeamMode.Squad });

    // Indomitable (lifeline): convert adrenaline to survive on 1 HP.
    const a = join(game, "A", 1);
    const b = join(game, "B", 1);
    const c = join(game, "C", 2);
    a.addPerk("lifeline", false, undefined, true);
    a.boost = 100;
    a.health = 100;
    hurt(c, a, 120);
    assert.equal(a.dead, false, "lifeline must survive a lethal hit");
    assert.equal(a.health, 1, "lifeline leaves the player at 1 HP");
    assert.ok(a.boost < 100, "lifeline converts adrenaline into survival");

    // Combat Stimulants: friendly gunfire heals teammates while active.
    const stim = join(game, "S", 1);
    stim.addPerk("combat_stims", false, undefined, true);
    (stim as unknown as { combatStimsActive: boolean; _combatStimsTicker: number }).combatStimsActive = true;
    (stim as unknown as { _combatStimsTicker: number })._combatStimsTicker = 5;
    b.health = 50;
    hurt(stim, b, 100, "ak47");
    assert.equal(b.health, 56, "combat_stims heals a friendly target hit by active stims gunfire");

    // AP Rounds reduce damage taken through armor. A melee source avoids the
    // random headshot roll so the assertion is deterministic.
    const armored = join(game, "Armor", 1);
    armored.chest = "chest01";
    armored.health = 100;
    hurt(c, armored, 50, "");
    const withArmor = armored.health;
    armored.health = 100;
    armored.damage({
        amount: 50,
        damageType: GameConfig.DamageType.Player,
        dir: { x: 1, y: 0 },
        source: c,
        gameSourceType: "",
        armorPenetration: 0.8,
    });
    assert.ok(armored.health < withArmor, "armor penetration deals more damage through armor");

    game.stop();
    console.log("New-perks port smoke test passed: lifeline, combat_stims and ap_rounds.");
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});
