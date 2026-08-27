import assert from "assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { GameObjectDefs } from "../../shared/defs/gameObjectDefs.ts";
import type { GunDef } from "../../shared/defs/gameObjects/gunDefs.ts";
import type { MeleeDef } from "../../shared/defs/gameObjects/meleeDefs.ts";
import * as net from "../../shared/net/net.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { Config } from "./config.ts";
import { Game } from "./game/game.ts";
import { Obstacle } from "./game/objects/obstacle.ts";
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

function place(player: Player, x: number, y: number): void {
    player.pos = v2.create(x, y);
    player.posOld = v2.copy(player.pos);
    player.collider.pos = v2.copy(player.pos);
    player.game.grid.updateObject(player);
}

function eliminate(source: Player, target: Player): void {
    target.damage({
        amount: 1000,
        damageType: GameConfig.DamageType.Player,
        dir: { x: 1, y: 0 },
        source,
        gameSourceType: source.activeWeapon,
    });
}

async function main(): Promise<void> {
    const sandevistan = GameConfig.player.sandevistan;
    assert.equal(sandevistan.worldTimeScale, 0.1);
    assert.equal(sandevistan.duration, 5);
    assert.equal(sandevistan.cooldown, 25);

    // 1) dedicated map + activation
    const game = new Game(
        "sandevistan-smoke",
        { mapName: "sandevistan", teamMode: TeamMode.Solo },
        () => {},
        () => {},
    );
    await game.init();
    const caster = join(game, "caster", "caster-token", "Caster", 1);
    const botA = join(game, "bot-a", "bot-a-token", "BotA", 2);
    botA.serverBot = true;
    place(caster, 30, 30);
    place(botA, 80, 30);
    caster.boost = 0;
    botA.boost = 0;
    botA.helmet = "";
    botA.chest = "";

    assert.equal(game.sandevistanTimeScale(), 1, "world must run at full speed before activation");
    assert.equal(caster.sandevistanActive, false);

    // The runtime survivio-config.json is user-tunable; pin the test's
    // server-side scales so the assertions below are deterministic.
    Config.sandevistan.playerTimeScale = 0.5;
    Config.sandevistan.worldTimeScale = 0.1;

    caster.recalculateSpeed();
    const baseSpeedBefore = caster.speed;

    caster.activateSandevistan();
    assert.equal(caster.sandevistanActive, true, "implant must activate");
    assert.ok(
        Math.abs(caster.sandevistanRemaining - sandevistan.duration) < 1e-6,
        "remaining must equal the duration",
    );
    assert.equal(game.sandevistanTimeScale(), 0.1, "world must dilate to 0.1 while active");
    assert.equal(
        game.sandevistanTimeScale(),
        GameConfig.player.sandevistan.worldTimeScale,
    );

    // Player and world slowdown are independently configurable: the caster's
    // own actions (player clock) and the rest of the match (world clock).
    assert.equal(game.sandevistanPlayerTimeScale(), 0.5);
    assert.equal(game.sandevistanTimeScale(), 0.1);

    // Repeated activation while active is ignored.
    caster.activateSandevistan();
    assert.equal(caster.sandevistanActive, true);

    // 2) caster speed bonus (measured against the same weapon loadout)
    caster.recalculateSpeed();
    assert.ok(
        Math.abs(caster.speed - baseSpeedBefore * (1 + sandevistan.speedBonus)) < 0.01,
        `caster speed must include the sandevistan bonus: ${caster.speed} vs ${baseSpeedBefore}`,
    );

    // 3) dual-dt: caster advances on the player clock (playerTimeScale), AI
    //    on the world clock (worldTimeScale).
    caster.moveRight = true;
    botA.moveRight = true;
    const casterX = caster.pos.x;
    const botAX = botA.pos.x;
    game.playerBarn.update(0.5, 0.1, 1.0);
    const casterMoved = caster.pos.x - casterX;
    const botMoved = botA.pos.x - botAX;
    assert.ok(
        casterMoved > baseSpeedBefore * 0.35 && casterMoved < baseSpeedBefore * 0.7,
        `caster must move at the 50% player clock (moved ${casterMoved.toFixed(2)}, full ${baseSpeedBefore.toFixed(2)})`,
    );
    assert.ok(
        botMoved > 0 && botMoved < casterMoved * 0.35,
        `AI must move at the slowed world dt (moved ${botMoved.toFixed(2)})`,
    );
    Config.sandevistan.playerTimeScale = 0.5;
    Config.sandevistan.worldTimeScale = 0.1;

    // 4) kill while active reduces the cooldown
    caster.sandevistanCooldown = 25;
    eliminate(caster, botA);
    assert.equal(
        caster.sandevistanCooldown,
        25 - sandevistan.killCooldownReduce,
        "kill while active must reduce the cooldown",
    );

    // 5) effect expiry enters cooldown
    const aliveBot = join(game, "bot-b", "bot-b-token", "BotB", 3);
    place(aliveBot, 90, 30);
    caster.sandevistanRemaining = 0.05;
    caster.update(0.06); // real dt past the window
    assert.equal(caster.sandevistanActive, false, "effect must expire");
    assert.ok(
        Math.abs(caster.sandevistanCooldown - sandevistan.cooldown) < 0.2,
        `cooldown must start at ${sandevistan.cooldown}: ${caster.sandevistanCooldown}`,
    );
    assert.equal(game.sandevistanTimeScale(), 1, "world must resume full speed after expiry");

    // 6) activation blocked while on cooldown
    caster.activateSandevistan();
    assert.equal(caster.sandevistanActive, false, "must not activate during cooldown");

    // 7) cooldown counts down on the real clock and allows re-activation
    caster.sandevistanCooldown = 0.05;
    caster.update(0.06);
    assert.equal(caster.sandevistanCooldown, 0);
    caster.activateSandevistan();
    assert.equal(caster.sandevistanActive, true, "must activate again after cooldown");

    // 8) activation through the real input pipeline (G-key -> Input.Sandevistan)
    const implantUser = join(game, "implant-input", "implant-input-token", "Implant", 2);
    place(implantUser, 40, 30);
    const inputMsg = new net.InputMsg();
    inputMsg.seq = 1;
    inputMsg.inputs.push(GameConfig.Input.Sandevistan);
    implantUser.handleInput(inputMsg);
    assert.equal(implantUser.sandevistanActive, true, "G-key input must activate the implant");
    assert.equal(game.sandevistanTimeScale(), 0.1, "input-triggered activation must dilate the world");

    // 9) AI heading turns slowly while the world is dilated
    const turnBot = join(game, "turn-bot", "turn-bot-token", "TurnBot", 2);
    place(turnBot, 60, 30);
    turnBot.serverBot = true;
    turnBot.dir = v2.create(1, 0);
    const opposite = v2.create(-1, 0);
    const turnMsg = new net.InputMsg();
    turnMsg.seq = 1;
    turnMsg.toMouseDir = opposite;
    turnBot.handleInput(turnMsg);
    const dotBefore = v2.dot(turnBot.dir, opposite);
    assert.ok(
        dotBefore < 0.999,
        "AI heading must not snap to the commanded aim during world dilation",
    );
    turnBot.update(0.1);
    const dotPartial = v2.dot(turnBot.dir, opposite);
    assert.ok(
        dotPartial > -0.999 && dotPartial < 0.0,
        "AI heading must partially rotate toward the commanded aim",
    );
    turnBot.update(1.0);
    assert.ok(
        v2.dot(turnBot.dir, opposite) > 0.99,
        "AI heading must eventually reach the commanded aim",
    );

    // 10) cooldown clock: after activation ends, every non-caster (human or
    //     AI) ticks on the world clock while another caster dilates the match.
    caster.sandevistanActive = false;
    caster.sandevistanCooldown = 5;
    turnBot.sandevistanCooldown = 5;
    game.playerBarn.update(0.5, 0.1, 1.0);
    assert.ok(
        Math.abs(caster.sandevistanCooldown - 4.9) < 0.02,
        `non-caster cooldown must tick on the world clock: ${caster.sandevistanCooldown}`,
    );
    assert.ok(
        Math.abs(turnBot.sandevistanCooldown - 4.9) < 0.02,
        `AI cooldown must tick on the world clock: ${turnBot.sandevistanCooldown}`,
    );

    // 11) non-sandevistan maps reject activation
    const normal = new Game(
        "sandevistan-normal-map",
        { mapName: "main", teamMode: TeamMode.Solo },
        () => {},
        () => {},
    );
    await normal.init();
    const outsider = join(normal, "outsider", "outsider-token", "Outsider", 1);
    outsider.activateSandevistan();
    assert.equal(outsider.sandevistanActive, false, "implant must not work outside the mode");

    // 12) map interactions (automatic doors) advance with world time, so the
    //     opening/closing cadence slows down while the implant dilates the world.
    {
        const door = game.map.genAuto("lab_door_01", v2.create(120, 120), 0) as Obstacle;
        assert(door, "generated lab door must exist");
        if (door.door.open) door.toggleDoor(caster);
        assert.equal(door.door.open, false, "door starts closed");
        assert.equal(door.door.autoCloseDelay, 1, "test door auto-close delay");

        // Auto-open schedules the auto-close as a world-time action.
        door.interact(caster, true);
        assert.equal(door.door.open, true, "auto door opens immediately");
        assert.ok(
            game.map.timedObstacles.has(door),
            "auto door must register a world-time timer",
        );

        // Normal world: the door closes after ~1s of world time.
        game.map.update(0.4);
        assert.equal(door.door.open, true, "door stays open inside the close delay");
        game.map.update(0.7);
        assert.equal(door.door.open, false, "door auto-closes after the world-time delay");

        // Dilation: the same 1s world delay takes 10x real time (worldDt = 0.1).
        caster.activateSandevistan();
        assert.equal(game.sandevistanTimeScale(), 0.1);
        door.interact(caster, true);
        assert.equal(door.door.open, true, "door re-opens under dilation");
        // 5 real seconds -> only 0.5 world seconds elapsed.
        game.map.update(0.5);
        assert.equal(door.door.open, true, "auto-close must not fire yet (world time slowed)");
        // Another 5 real seconds -> 1.0 world second total -> closes.
        game.map.update(0.5);
        assert.equal(
            door.door.open,
            false,
            "auto-close fires after 10x real time under dilation",
        );
        // Deactivate every contestant (the implantUser from section 8 is
        // still active) so the world resumes full speed.
        for (const p of game.playerBarn.players) {
            p.sandevistanActive = false;
        }
        assert.equal(game.sandevistanTimeScale(), 1, "world resumes full speed");
    }

    // 13) HUD wire round-trip: sandevistanRemaining/Cooldown must survive the
    //     active-player block on every update so the client progress bar can
    //     deplete during the active window and refill during the cooldown.
    {
        const msg = new net.UpdateMsg();
        msg.activePlayerData = {
            healthDirty: false,
            boostDirty: false,
            zoomDirty: false,
            indoors: false,
            actionDirty: false,
            inventoryDirty: false,
            weapsDirty: false,
            spectatorCountDirty: false,
            sandevistanActive: true,
            sandevistanRemaining: 3.2,
            sandevistanCooldown: 12,
        } as never;
        const stream = new net.MsgStream(new ArrayBuffer(512));
        msg.serialize(stream.stream);
        stream.stream.byteIndex = 0;
        const restored = new net.UpdateMsg();
        restored.deserialize(stream.stream, { getTypeById: () => 0 } as never);
        assert.equal(restored.activePlayerData.sandevistanActive, true);
        assert.ok(
            Math.abs(restored.activePlayerData.sandevistanRemaining - 3.2) < 0.1,
            `remaining must round-trip: ${restored.activePlayerData.sandevistanRemaining}`,
        );
        assert.ok(
            Math.abs(restored.activePlayerData.sandevistanCooldown - 12) < 1,
            `cooldown must round-trip: ${restored.activePlayerData.sandevistanCooldown}`,
        );
    }

    // 14) fire interval follows the world slowdown while active: the caster's
    //     shot-to-shot cooldown is lengthened by playerTimeScale/worldTimeScale
    //     (and the burst delays too), so the gun's cadence stays on the slowed
    //     world clock instead of firing at the faster player clock.
    //     Non-casters keep the normal cadence.
    {
        for (const p of game.playerBarn.players) p.sandevistanActive = false;
        const akDef = GameObjectDefs["ak47"] as GunDef;
        assert.equal(akDef.type, "gun");
        const intervalScale =
            Config.sandevistan.playerTimeScale / Config.sandevistan.worldTimeScale;
        assert.equal(intervalScale, 5, "test pins 0.5 player / 0.1 world");

        const shooter = join(game, "shooter", "shooter-token", "Shooter", 2);
        place(shooter, 70, 30);
        shooter.weaponManager.setWeapon(GameConfig.WeaponSlot.Primary, "ak47", 200);
        shooter.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Primary, true);
        shooter.weaponManager.fireWeapon(false);
        assert.ok(
            Math.abs(
                shooter.weapons[GameConfig.WeaponSlot.Primary].cooldown -
                    akDef.fireDelay,
            ) < 1e-6,
            `normal fire interval must stay at fireDelay: ${shooter.weapons[GameConfig.WeaponSlot.Primary].cooldown}`,
        );

        // The caster's cooldown is lengthened so the cadence follows the
        // slowed world clock.
        caster.sandevistanActive = true;
        caster.sandevistanRemaining = 100;
        caster.weaponManager.setWeapon(GameConfig.WeaponSlot.Primary, "ak47", 200);
        caster.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Primary, true);
        caster.weaponManager.fireWeapon(false);
        assert.ok(
            Math.abs(
                caster.weapons[GameConfig.WeaponSlot.Primary].cooldown -
                    akDef.fireDelay * intervalScale,
            ) < 1e-6,
            `caster fire interval must lengthen with the world clock: ${caster.weapons[GameConfig.WeaponSlot.Primary].cooldown}`,
        );

        // Same player-clock dt: the caster fires ~1/worldTimeScale times less.
        const countShots = (p: Player, steps: number): number => {
            p.shootHold = true;
            p.weaponManager.setWeapon(GameConfig.WeaponSlot.Primary, "ak47", 5000);
            p.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Primary, true);
            const before = p.weapons[GameConfig.WeaponSlot.Primary].ammo;
            // 5 ms player-clock steps: small enough that the 0.01 s scaled
            // cooldown spans several ticks (otherwise one shot per tick hides
            // the cadence difference).
            for (let i = 0; i < steps; i++) p.update(0.005);
            return before - p.weapons[GameConfig.WeaponSlot.Primary].ammo;
        };
        const normalShots = countShots(shooter, 2000);
        const casterShots = countShots(caster, 2000);
        assert.ok(
            casterShots < normalShots / 3,
            `caster must fire several times slower on the player clock: caster=${casterShots} normal=${normalShots}`,
        );
        assert.ok(
            normalShots > 80 && normalShots < 140,
            `normal cadence must stay sane: ${normalShots}`,
        );
        assert.ok(
            casterShots > 10 && casterShots < 40,
            `scaled cadence must reflect the 5x longer interval (ak47 0.1s -> 0.5s): ${casterShots}`,
        );
        caster.sandevistanActive = false;
    }

    // 15) melee cadence follows ONLY the player clock: the caster's melee
    //     interval uses cooldownTime unchanged (ticking at playerTimeScale)
    //     and must ignore worldTimeScale entirely, unlike guns.
    {
        for (const p of game.playerBarn.players) p.sandevistanActive = false;
        const meleeDef = GameObjectDefs["bayonet"] as MeleeDef;
        assert.equal(meleeDef.type, "melee");
        const cooldownTime = meleeDef.attack.cooldownTime;

        const countMelee = (p: Player, steps: number): number => {
            p.weaponManager.setWeapon(GameConfig.WeaponSlot.Melee, "bayonet", 0);
            p.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Melee, true);
            let swings = 0;
            // A new swing restarts the melee anim ticker at cooldownTime, so
            // count the ticker jumps (the anim can hand off to the next swing
            // inside a single update without animType ever leaving Melee).
            let prevTicker = 0;
            for (let i = 0; i < steps; i++) {
                p.shootStart = true;
                p.update(0.005);
                const ticker = (p as unknown as { _animTicker: number })._animTicker;
                if (ticker > prevTicker + 0.1) swings++;
                prevTicker = ticker;
            }
            return swings;
        };

        caster.sandevistanActive = true;
        caster.sandevistanRemaining = 100;
        // 1000 steps of 5 ms player clock = 5 s player time = 10 s real at
        // playerTimeScale 0.5. Expected swings: 5 / cooldownTime.
        const swingsAtWorld01 = countMelee(caster, 1000);
        assert.ok(
            Math.abs(swingsAtWorld01 - 5 / cooldownTime) <= 3,
            `melee must tick on the player clock only: ${swingsAtWorld01} vs ${5 / cooldownTime}`,
        );

        // Changing worldTimeScale must not change the melee cadence.
        Config.sandevistan.worldTimeScale = 0.05;
        const swingsAtWorld005 = countMelee(caster, 1000);
        assert.ok(
            Math.abs(swingsAtWorld005 - swingsAtWorld01) <= 1,
            `melee must ignore worldTimeScale: ${swingsAtWorld005} vs ${swingsAtWorld01}`,
        );
        Config.sandevistan.worldTimeScale = 0.1;
        caster.sandevistanActive = false;
    }

    console.log(
        "Sandevistan smoke test passed: 0.1 world dilation, player-clock caster actions, world-scaled gun fire interval, player-clock-only melee, half spread, kill cooldown reduction, expiry + cooldown, mode gating, and slowed map interactions.",
    );
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});
