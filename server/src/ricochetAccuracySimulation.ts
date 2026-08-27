import assert from "node:assert/strict";
import { GameObjectDefs } from "../../shared/defs/gameObjectDefs.ts";
import type { BulletDef } from "../../shared/defs/gameObjects/bulletDefs.ts";
import type { GunDef } from "../../shared/defs/gameObjects/gunDefs.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { JoinMsg } from "../../shared/net/joinMsg.ts";
import { ObjectType } from "../../shared/net/objectSerializeFns.ts";
import { v2, type Vec2 } from "../../shared/utils/v2.ts";
import {
    chooseForbiddenIndirectShot,
    decodeForbiddenInputDirection,
    type ForbiddenIndirectShotPlan,
} from "./bot/forbiddenCombat.ts";
import { snapshotLocalBallisticObstacle } from "./bot/smartBotSupport.ts";
import { Game } from "./game/game.ts";

type Mode = "static-exact" | "static-gate" | "moving-exact" | "moving-gate";
type Result = { planned: number; reflected: number; hits: number; attempts: number };

const rng = (() => {
    let state = 0x53b0a11;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let value = Math.imul(state ^ (state >>> 15), 1 | state);
        value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
})();

const polar = (angle: number, radius: number): Vec2 => ({
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
});

function join(game: Game, socket: string, token: string, name: string) {
    game.addJoinToken(token, true, 1, 60_000, false, false, undefined);
    const msg = new JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = name;
    const player = game.playerBarn.addPlayer(socket, msg);
    assert(player, `${name} must join the simulation`);
    return player;
}

async function main(): Promise<void> {
    const game = new Game(
        `ricochet-accuracy-${Math.random().toString(36).slice(2)}`,
        { mapName: "duel", teamMode: TeamMode.Solo, duelWeapons: ["ak47", "mosin"] },
        () => {},
        () => {},
    );
    await game.init();

    for (const obstacle of game.map.obstacles) obstacle.dead = true;
    const centre = { x: game.map.width / 2, y: game.map.height / 2 };
    const barrel = game.map.genObstacle("barrel_01", centre, 0, 0, 1);
    barrel.health = 1_000_000;
    barrel.maxHealth = 1_000_000;
    barrel.healthT = 1;

    const shooter = join(game, "ricochet-shooter", "ricochet-shooter", "RicochetShooter");
    const target = join(game, "ricochet-target", "ricochet-target", "RicochetTarget");
    shooter.layer = 0;
    target.layer = 0;
    shooter.groupId = 1;
    target.groupId = 2;

    const barrelSnapshot = snapshotLocalBallisticObstacle({
        __id: barrel.__id,
        __type: ObjectType.Obstacle,
        data: {
            type: "barrel_01",
            pos: centre,
            layer: 0,
            scale: 1,
            dead: false,
            healthT: 1,
        },
    });
    assert(barrelSnapshot && barrelSnapshot.collider.type === 0);
    assert.equal(barrelSnapshot.collider.rad, 1.75);

    const weapons = ["ak47", "m39", "mosin", "mac10"] as const;
    const modes: Mode[] = [
        "static-exact",
        "static-gate",
        "moving-exact",
        "moving-gate",
    ];
    const wanted = Math.max(10, Number(process.env.RICOCHET_TRIALS ?? 60));
    const gateRadians = Math.max(
        0,
        Number(process.env.RICOCHET_GATE_RAD ?? 0.0006),
    );
    const results: Record<string, Result> = {};

    const setPlayerPosition = (player: typeof shooter, pos: Vec2): void => {
        player.pos.x = pos.x;
        player.pos.y = pos.y;
        player.posOld.x = pos.x;
        player.posOld.y = pos.y;
        game.grid.updateObject(player);
    };

    const firePlan = (
        weaponType: string,
        gun: GunDef,
        plan: ForbiddenIndirectShotPlan,
        velocity: Vec2,
        aimError: number,
        initialTargetPos: Vec2,
    ): { reflected: boolean; hit: boolean } => {
        game.bulletBarn.bullets.length = 0;
        game.bulletBarn.newBullets.length = 0;
        game.bulletBarn.damages.length = 0;
        barrel.dead = false;
        barrel.health = 1_000_000;
        barrel.maxHealth = 1_000_000;
        barrel.healthT = 1;
        target.dead = false;
        target.downed = false;
        target.health = 100;
        target.boost = 0;
        setPlayerPosition(target, initialTargetPos);

        const plannedDirection = v2.normalize(v2.sub(plan.aimPoint, shooter.pos));
        // The real bot sends InputMsg.toMouseDir as a 10-bit unit vector; use
        // the server-decoded direction rather than ideal floating-point aim.
        const shotDirection = decodeForbiddenInputDirection(
            v2.rotate(plannedDirection, aimError),
            10,
        );
        const gunPosition = v2.add(
            shooter.pos,
            v2.mul(v2.perp(shotDirection), Number(gun.barrelOffset ?? 0)),
        );
        const shotPosition = v2.add(
            gunPosition,
            v2.mul(shotDirection, Math.max(0, Number(gun.barrelLength ?? 0))),
        );
        const initialBullet = game.bulletBarn.fireBullet({
            bulletType: gun.bulletType,
            gameSourceType: weaponType,
            pos: shotPosition,
            dir: shotDirection,
            layer: 0,
            damageMult: 1,
            damageType: GameConfig.DamageType.Player,
            playerId: shooter.__id,
        });

        const dt = 1 / 100;
        for (let tick = 0; tick < 350; tick += 1) {
            target.pos.x += velocity.x * dt;
            target.pos.y += velocity.y * dt;
            game.grid.updateObject(target);
            game.bulletBarn.update(dt);
            if (game.bulletBarn.bullets.length === 0) break;
        }
        return {
            reflected: initialBullet.reflected,
            hit: initialBullet.reflected && target.health < 99.99,
        };
    };

    for (const weaponType of weapons) {
        const gun = GameObjectDefs[weaponType] as GunDef;
        const bullet = GameObjectDefs[gun.bulletType] as BulletDef;
        assert.equal(gun.type, "gun");
        assert.equal(bullet.type, "bullet");

        for (const mode of modes) {
            const result: Result = { planned: 0, reflected: 0, hits: 0, attempts: 0 };
            results[`${weaponType}:${mode}`] = result;
            while (result.planned < wanted && result.attempts < wanted * 40) {
                result.attempts += 1;
                const shooterAngle = rng() * Math.PI * 2;
                const targetAngle = rng() * Math.PI * 2;
                const shooterRadius = 16 + rng() * 16;
                const targetRadius = 14 + rng() * 22;
                const shooterPos = v2.add(centre, polar(shooterAngle, shooterRadius));
                const targetPos = v2.add(centre, polar(targetAngle, targetRadius));
                const moving = mode.startsWith("moving");
                const velocity = moving
                    ? polar(rng() * Math.PI * 2, 1.5 + rng() * 5.5)
                    : v2.create(0, 0);
                setPlayerPosition(shooter, shooterPos);
                setPlayerPosition(target, targetPos);

                const plan = chooseForbiddenIndirectShot({
                    from: shooterPos,
                    enemyPos: targetPos,
                    enemyVelocity: velocity,
                    layer: 0,
                    obstacles: [barrelSnapshot],
                    bulletRange: Number(bullet.distance),
                    bulletDamage: Number(bullet.damage),
                    obstacleDamage: Number(bullet.obstacleDamage),
                    armorPiercing: Boolean(
                        (bullet as BulletDef & { armorPiercing?: boolean }).armorPiercing,
                    ),
                    stonePiercing: Boolean(
                        (bullet as BulletDef & { stonePiercing?: boolean }).stonePiercing,
                    ),
                    canRicochet: true,
                    bulletSpeed: Number(bullet.speed) * (1 + Number(bullet.variance ?? 0)),
                    targetRadius: target.rad,
                    spreadRadians: 0,
                    barrelLength: Number(gun.barrelLength ?? 0),
                    reflectDistanceDecay: GameConfig.bullet.reflectDistDecay,
                });
                if (!plan || plan.kind !== "ricochet") continue;

                result.planned += 1;
                const aimError = mode.endsWith("gate")
                    ? (rng() * 2 - 1) * gateRadians
                    : 0;
                const outcome = firePlan(
                    weaponType,
                    gun,
                    plan,
                    velocity,
                    aimError,
                    targetPos,
                );
                if (outcome.reflected) result.reflected += 1;
                if (outcome.hit) result.hits += 1;
            }
            assert.equal(result.planned, wanted, `${weaponType}/${mode} must find enough legal plans`);
        }
    }

    const table = Object.entries(results).map(([key, value]) => ({
        weapon: key.split(":")[0],
        mode: key.split(":")[1],
        shots: value.planned,
        reflected: `${((value.reflected / value.planned) * 100).toFixed(1)}%`,
        hits: `${((value.hits / value.planned) * 100).toFixed(1)}%`,
    }));
    for (const [key, value] of Object.entries(results)) {
        assert.ok(
            value.reflected / value.planned >= 0.9,
            `${key} reflection rate must remain at least 90%`,
        );
        assert.ok(
            value.hits / value.planned >= 0.9,
            `${key} reflected-hit rate must remain at least 90%`,
        );
    }
    console.table(table);

    const aggregate = Object.values(results).reduce(
        (sum, value) => ({
            planned: sum.planned + value.planned,
            reflected: sum.reflected + value.reflected,
            hits: sum.hits + value.hits,
            attempts: sum.attempts + value.attempts,
        }),
        { planned: 0, reflected: 0, hits: 0, attempts: 0 },
    );
    console.log("Ricochet authoritative-physics aggregate", {
        shots: aggregate.planned,
        gateRadians,
        gateDegrees: (gateRadians * 180) / Math.PI,
        reflectionRate: aggregate.reflected / aggregate.planned,
        hitRate: aggregate.hits / aggregate.planned,
    });
    assert.ok(
        aggregate.hits / aggregate.planned >= 0.95,
        "aggregate authoritative reflected-hit rate must remain at least 95%",
    );
    game.stop();
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});
