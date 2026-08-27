import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { ZOMBIE_RUSH_SPEED_MULT } from "../../shared/defs/zombieDefs.ts";
import { Game } from "./game/game.ts";
import type { Player } from "./game/objects/player.ts";

let seq = 0;
function join(game: Game, name: string, serverBot: boolean): Player {
    const token = `rush-continuity-${++seq}`;
    game.addJoinToken(token, false, 1, 60_000, false, serverBot);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = name;
    msg.loadoutPriv = "";
    const player = game.playerBarn.addPlayer(`${name}-${seq}-socket`, msg);
    if (!player) throw new Error(`failed to join ${name}`);
    return player;
}

function movePlayer(player: Player, x: number, y: number): void {
    player.pos.x = x;
    player.pos.y = y;
    (player as unknown as { collider: { pos: { x: number; y: number } } }).collider.pos =
        player.pos;
    player.game.grid.updateObject(player);
}

void (async () => {
    const game = new Game(
        `rush-continuity-${Date.now()}`,
        { mapName: "zombie", teamMode: TeamMode.Solo, zombieDifficulty: "normal" },
        () => {},
        () => {},
    );
    try {
        await game.init();
        (game as unknown as { started: boolean }).started = true;
        const human = join(game, "Human", false);
        human.spawnProtectionUntil = 0;
        const system = game.zombieMode as unknown as {
            zombies: Player[];
            cachedTargets: Map<number, Player>;
            spawnedInitial: boolean;
            targetCacheUntil: number;
            update(dt: number): void;
        };
        system.spawnedInitial = true;

        // Find a genuinely open 10-unit lane so the initial rush is not map-seed dependent.
        const center = game.map.center;
        let lane: { human: { x: number; y: number }; zombie: { x: number; y: number } } | null = null;
        outer: for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
            for (const radius of [30, 45, 60, 75]) {
                const hp = v2.create(
                    center.x + Math.cos(angle) * radius,
                    center.y + Math.sin(angle) * radius,
                );
                for (const laneAngle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
                    const zp = v2.create(
                        hp.x + Math.cos(laneAngle) * 10,
                        hp.y + Math.sin(laneAngle) * 10,
                    );
                    if (game.map.hasPlayerWalkPath(zp, hp, 0, 0.72)) {
                        lane = { human: hp, zombie: zp };
                        break outer;
                    }
                }
            }
        }
        assert.ok(lane, "an open rush lane exists");
        movePlayer(human, lane.human.x, lane.human.y);
        human.layer = 0;

        const zombie = join(game, "Bomber", true);
        movePlayer(zombie, lane.zombie.x, lane.zombie.y);
        zombie.layer = 0;
        zombie.zombieSelfDestruct = true;
        zombie.zombieAttackCooldownUntil = 0;
        system.zombies.push(zombie);
        system.cachedTargets.set(zombie.__id, human);
        system.targetCacheUntil = Date.now() + 60_000;

        // Authoritative rush speed is a persistent state multiplier, not a 0.6s haste timer.
        zombie.zombieRushing = false;
        zombie.hasteType = GameConfig.HasteType.None;
        zombie.recalculateSpeed();
        const normalSpeed = zombie.speed;
        zombie.zombieRushing = true;
        zombie.recalculateSpeed();
        const rushSpeed = zombie.speed;
        assert.ok(
            Math.abs(rushSpeed / normalSpeed - ZOMBIE_RUSH_SPEED_MULT) < 0.001,
            `rush speed ${rushSpeed.toFixed(3)} must be ${ZOMBIE_RUSH_SPEED_MULT}x normal ${normalSpeed.toFixed(3)}`,
        );

        // Re-enter through the real trigger path.
        zombie.zombieRushing = false;
        zombie.zombieLosUntil = 0;
        system.update(0.016);
        assert.equal(zombie.zombieRushing, true, "clear close lane starts committed rush");

        // Simulate a transient LOS/path failure on the next authoritative check.
        const originalHasPath = game.map.hasPlayerWalkPath.bind(game.map);
        game.map.hasPlayerWalkPath = (() => false) as typeof game.map.hasPlayerWalkPath;
        zombie.zombieLosUntil = 0;
        system.update(0.016);
        assert.equal(
            zombie.zombieRushing,
            true,
            "brief LOS loss must not cancel an already committed self-destruct rush",
        );
        assert.ok(
            zombie.moveLeft || zombie.moveRight || zombie.moveUp || zombie.moveDown,
            "blocked committed bomber must continue outputting movement instead of stopping",
        );
        game.map.hasPlayerWalkPath = originalHasPath;

        // A previous ordinary melee cooldown must never make a bomber stand still at contact.
        // Stay on the same lane already proven walkable above; x+2 was seed-dependent
        // and could accidentally place the bomber across a nearby obstacle edge.
        const contactDir = v2.normalizeSafe(
            v2.sub(lane.zombie, lane.human),
            v2.create(1, 0),
        );
        const contactPos = v2.add(lane.human, v2.mul(contactDir, 2));
        assert.equal(
            game.map.hasPlayerWalkPath(contactPos, lane.human, 0, 0.72),
            true,
            "contact point remains on the proven open rush lane",
        );
        movePlayer(zombie, contactPos.x, contactPos.y);
        zombie.dead = false;
        zombie.health = 100;
        zombie.zombieRushing = true;
        zombie.zombieLosUntil = 0;
        zombie.zombieAttackCooldownUntil = Date.now() + 60_000;
        system.cachedTargets.set(zombie.__id, human);
        system.targetCacheUntil = Date.now() + 60_000;
        system.update(0.016);
        assert.equal(zombie.dead, true, "clear contact detonates even while melee cooldown is active");

        console.log(
            `✓ self-destruct rush continuity: ${normalSpeed.toFixed(2)} -> ${rushSpeed.toFixed(2)} (${ZOMBIE_RUSH_SPEED_MULT}x), LOS flicker preserved rush, cooldown cannot stall contact detonation`,
        );
    } finally {
        game.stop();
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
