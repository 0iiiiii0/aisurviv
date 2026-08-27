import assert from "assert/strict";
import fs from "fs";
import path from "path";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Game } from "./game/game.ts";

const weaponManagerSource = fs.readFileSync(path.join(__dirname, "game", "weaponManager.ts"), "utf8");
assert.match(
    weaponManagerSource,
    /reload\(\): void \{[\s\S]{0,200}if \(!this\.weapons\[this\.curWeapIdx\]\.type\) return;/,
    "reload must guard against an emptied weapon slot",
);

function join(game: Game, socketId: string, token: string, name: string) {
    game.addJoinToken(token, true, 1, 60_000, false, true, [1]);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = name;
    const player = game.playerBarn.addPlayer(socketId, msg);
    assert(player);
    return player;
}

async function main(): Promise<void> {
    const game = new Game(
        "reload-guard-smoke",
        { mapName: "main", teamMode: TeamMode.Solo },
        () => {},
        () => {},
    );
    await game.init();

    const player = join(game, "reload-socket", "reload-token", "Reloader");
    // A normal gun must still reload after adding the guard.
    player.weaponManager.setWeapon(GameConfig.WeaponSlot.Primary, "ak47", 5);
    player.inventory["762mm"] = 60;
    player.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Primary, true);
    player.weaponManager.reload();
    assert.ok(
        player.weapons[GameConfig.WeaponSlot.Primary].ammo > 5,
        "gun reload must still work",
    );

    // Directly exercising the guard: an empty active slot (as can transiently
    // happen when a gun is dropped mid-action) must not crash reload().
    player.weaponManager.setWeapon(GameConfig.WeaponSlot.Primary, "", 0);
    player.weapons[player.curWeapIdx].type = "";
    assert.equal(player.weapons[player.curWeapIdx].type, "");
    player.weaponManager.reload();
    assert.equal(player.weapons[player.curWeapIdx].type, "");

    console.log("Reload guard smoke test passed: empty weapon slots are a safe no-op and guns still reload.");
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});
