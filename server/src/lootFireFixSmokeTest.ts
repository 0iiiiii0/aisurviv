import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Game } from "./game/game.ts";

async function main(): Promise<void> {
    const game = new Game(
        "loot-fire-fix",
        { mapName: "main", teamMode: TeamMode.Solo },
        () => {},
        () => {},
    );
    await game.init();
    const token = "fix-token";
    game.addJoinToken(token, true, 1, 60_000, false, false, [1]);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = "Fix";
    const p = game.playerBarn.addPlayer("fix", msg);
    assert(p, "test player must join");
    p.pos = { x: 30, y: 30 } as never;

    // 1) Burst weapons (m93r) fire only while shootHold is held. The old bot
    //    code sent shootStart without shootHold for burst weapons, so they
    //    never fired and the bot kept swapping guns instead of attacking.
    p.weaponManager.setWeapon(GameConfig.WeaponSlot.Primary, "m93r", 30);
    p.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Primary, true);
    p.shootHold = true;
    for (let i = 0; i < 200; i++) p.update(0.02);
    const heldAmmo = p.weapons[GameConfig.WeaponSlot.Primary].ammo;
    assert.ok(
        heldAmmo < 30,
        `burst weapon must fire while shootHold is held: ammo=${heldAmmo}`,
    );

    p.weaponManager.setWeapon(GameConfig.WeaponSlot.Primary, "m93r", 30);
    p.shootHold = false;
    for (let i = 0; i < 200; i++) {
        p.shootStart = true;
        p.update(0.02);
    }
    const clickedAmmo = p.weapons[GameConfig.WeaponSlot.Primary].ammo;
    assert.equal(
        clickedAmmo,
        30,
        "click-only (shootStart without hold) must not fire a burst weapon",
    );

    // 2) Source guards for the smartBot fixes.
    const smartBotSource = fs.readFileSync(
    path.join(__dirname, "smartBot.ts"),
    "utf8",
) + "\n" + fs.readFileSync(path.join(__dirname, "bot", "smartBotSupport.ts"), "utf8");
    assert.match(smartBotSource, /const holdToFire = /, "smartBot must define holdToFire");
    assert.match(
        smartBotSource,
        /fireMode === "burst"/,
        "holdToFire must treat burst weapons as hold-fired",
    );
    assert.match(
        smartBotSource,
        /this\.output\.shootHold = holdToFire\(def\);|this\.output\.shootHold = holdToFire\(definition\);|this\.output\.shootHold = holdToFire\(gunDef\);|this\.output\.shootHold = !shootingCover && holdToFire\(currentDef\);/,
        "combat fire paths must use holdToFire (including burst)",
    );
    assert.match(
        smartBotSource,
        /current >= desired\) \{\s*return -100;/,
        "ammo scoring must stop only at the desired reserve, not before",
    );
    assert.match(
        smartBotSource,
        /Math\.max\(30, this\.desiredAmmo\(type\) \* 0\.85\)/,
        "urgent ammo reserve must target 85% of desired",
    );
    assert.match(
        smartBotSource,
        /choice\.distance <= pickupDistance\) attemptPickup\(\);/,
        "loot pickup must press inside the server pickup circle",
    );
    assert.match(
        smartBotSource,
        /def\.type === "heal" \|\| def\.type === "boost"/,
        "urgent equipment loot must include medicine",
    );
    assert.match(
        smartBotSource,
        /type === "healthkit" \? 70 : 12/,
        "healthkit loot value must beat bandages",
    );
    assert.match(
        smartBotSource,
        /medicineNeed/,
        "low-health bots without medicine must prioritise medicine loot",
    );
    assert.match(smartBotSource, /private hasAnyMedicine/, "medicine inventory check helper must exist");

    console.log(
        "AI loot & fire-hold smoke test passed: burst weapons fire on hold, ammo/medicine stacks stay attractive.",
    );
    process.exit(0);
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});
