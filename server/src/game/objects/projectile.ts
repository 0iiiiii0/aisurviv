import { GameObjectDefs } from "../../../../shared/defs/register.ts";
import { DamageType, GameConfig } from "../../../../shared/gameConfig.ts";
import { ObjectType } from "../../../../shared/net/objectSerializeFns.ts";
import { type AABB, coldet } from "../../../../shared/utils/coldet.ts";
import { collider } from "../../../../shared/utils/collider.ts";
import { math } from "../../../../shared/utils/math.ts";
import { util } from "../../../../shared/utils/util.ts";
import { v2, type Vec2 } from "../../../../shared/utils/v2.ts";
import type { Game } from "../game.ts";
import { BaseGameObject, type TrainingShotToken } from "./gameObject.ts";

// 10.5 is based on the distance a potato cannon projectile traveled before hitting the floor
// and exploding, from recorded packets from the original game
const gravity = 10.5;

/**
 * Minimum interval between airstrike call-ins for a human player. One beacon
 * already produces three strike lanes across a three-second window, so this
 * bounds carpet bombing without removing beacons as a strong tool. Server
 * bots are exempt (AI needs the same weapon to fight back).
 */
export function getStrobeAirstrikeOffsets(hasBrokenArrow: boolean): number[] {
    // Match the maintained game implementation: an ordinary strobe produces
    // three passes; the actual Broken Arrow perk adds two more. Carrying
    // multiple strobes by itself must never change the server-side perk rules.
    return hasBrokenArrow ? [0, 5, -5, 10, -10] : [0, 5, -5];
}

export function getStrobeAirstrikeIntervalMs(hasBrokenArrow: boolean): number {
    // All passes are distributed across the same three-second strike window.
    return Math.round(3000 / getStrobeAirstrikeOffsets(hasBrokenArrow).length);
}

export interface StrobeAirstrikeWarning {
    pos: Vec2;
    rad: number;
    duration: number;
    impactIn: number;
    highDamageRad: number;
}

/**
 * Predicts the position of a live strobe when its first airstrike is scheduled.
 * This mirrors the projectile drag closely enough to warn server-controlled
 * bots as soon as the beacon leaves the thrower's hand, rather than waiting
 * for the first plane/bomb to exist.
 */
export function predictStrobeAirstrikeWarning(
    projectile: Pick<
        Projectile,
        "pos" | "vel" | "posZ" | "velZ" | "createdAtMs"
    >,
    hasBrokenArrow: boolean,
    mapWidth: number,
    mapHeight: number,
    timestamp = Date.now(),
): StrobeAirstrikeWarning | null {
    const strikeDelay = 2.5;
    const offsets = getStrobeAirstrikeOffsets(hasBrokenArrow);
    const laneIntervalSeconds = getStrobeAirstrikeIntervalMs(hasBrokenArrow) / 1000;
    const ageSeconds = Math.max(0, (timestamp - projectile.createdAtMs) / 1000);
    // Plane approach is ~0.3 s and the last iron bombs need about one second
    // to fall. Retain a conservative tail so bots do not run back into the
    // final lanes.
    const dangerEndSeconds = strikeDelay + Math.max(0, offsets.length - 1) * laneIntervalSeconds + 1.65;
    if (ageSeconds > dangerEndSeconds) return null;

    const remaining = Math.max(0, strikeDelay - ageSeconds);
    let pos = v2.copy(projectile.pos);
    let velocity = v2.copy(projectile.vel);
    let posZ = math.clamp(Number(projectile.posZ) || 0, 0, GameConfig.projectile.maxHeight);
    let velocityZ = Number.isFinite(projectile.velZ) ? projectile.velZ : 0;
    let elapsed = 0;
    const fixedStep = 1 / 120;
    while (elapsed < remaining - 1e-8) {
        const dt = Math.min(fixedStep, remaining - elapsed);
        velocity = v2.mul(velocity, 1 / (1 + dt * (posZ !== 0 ? 1.2 : 2)));
        pos = v2.add(pos, v2.mul(velocity, dt));
        velocityZ -= gravity * dt;
        posZ = math.clamp(
            posZ + velocityZ * dt,
            0,
            GameConfig.projectile.maxHeight,
        );
        elapsed += dt;
    }
    pos.x = math.clamp(Number.isFinite(pos.x) ? pos.x : 0, 1, Math.max(1, mapWidth - 1));
    pos.y = math.clamp(Number.isFinite(pos.y) ? pos.y : 0, 1, Math.max(1, mapHeight - 1));

    return {
        pos,
        // Normal strobes have three lanes around the center. Broken Arrow's
        // additional outer lanes need a larger conservative evacuation radius.
        rad: hasBrokenArrow ? 34 : 17,
        duration: Math.max(0.25, dangerEndSeconds - ageSeconds),
        impactIn: Math.max(0, strikeDelay - ageSeconds),
        // Most overlapping bomb lanes and therefore the largest expected burst
        // damage occur around the center. This conservative core is used only
        // for AI priority; the full radius remains the eventual evacuation goal.
        highDamageRad: hasBrokenArrow ? 25 : 11.5,
    };
}

export class ProjectileBarn {
    projectiles: Projectile[] = [];
    constructor(readonly game: Game) {}

    update(dt: number) {
        for (let i = 0; i < this.projectiles.length; i++) {
            const proj = this.projectiles[i];
            if (proj.destroyed) {
                this.projectiles.splice(i, 1);
                i--;
                continue;
            }
            proj.update(dt);
        }
    }

    clearForArenaRound(): void {
        for (const projectile of this.projectiles) {
            if (!projectile.destroyed) projectile.destroy();
        }
        this.projectiles.length = 0;
    }

    addProjectile(
        playerId: number,
        type: string,
        pos: Vec2,
        posZ: number,
        layer: number,
        vel: Vec2,
        fuseTime: number,
        damageType: DamageType,
        throwDir?: Vec2,
        weaponSourceType?: string,
        trainingShot?: TrainingShotToken,
    ): Projectile {
        const proj = new Projectile(
            this.game,
            type,
            pos,
            layer,
            posZ,
            playerId,
            vel,
            fuseTime,
            damageType,
            throwDir,
            weaponSourceType,
            trainingShot,
        );

        this.projectiles.push(proj);
        this.game.objectRegister.register(proj);
        return proj;
    }

    addSplitProjectiles(
        playerId: number,
        type: string,
        pos: Vec2,
        layer: number,
        initialVel: Vec2,
        count: number,
        maxVel: number,
        weaponSourceType?: string,
        trainingShot?: TrainingShotToken,
    ) {
        for (let i = 0; i < count; i++) {
            const def = GameObjectDefs.typeToDef(type, "throwable");

            const vel = util.randomPointInCircle(maxVel);
            const velocity = v2.add(v2.mul(initialVel, 0.6), vel);

            this.game.projectileBarn.addProjectile(
                playerId,
                type,
                pos,
                1,
                layer,
                velocity,
                def.fuseTime,
                DamageType.Player,
                undefined,
                weaponSourceType,
                trainingShot,
            );
        }
    }
}

export class Projectile extends BaseGameObject {
    override readonly __type = ObjectType.Projectile;
    readonly createdAtMs = Date.now();
    bounds: AABB;

    layer: number;

    posZ: number;
    dir: Vec2;
    throwDir: Vec2;

    type: string;
    // used for "heavy" potatos and snowballs
    // so the kill source is still the regular potato
    weaponSourceType: string;

    rad: number;

    playerId: number;
    fuseTime: number;
    damageType: DamageType;
    trainingShot?: TrainingShotToken;

    vel: Vec2;
    velZ: number;
    dead = false;

    /**
     * 0 if not on top of an obstacle
     * aka on the ground
     */
    obstacleBellowHeight = 0;

    strobe?: {
        timeToPing: number;
        airstrikesTotal: number;
        airstrikesLeft: number;
        airstrikeTicker: number;
        airstrikeDelay: number;
        airstrikeOffset: number;
        rotAngle: number;
    };

    constructor(
        game: Game,
        type: string,
        pos: Vec2,
        layer: number,
        posZ: number,
        playerId: number,
        vel: Vec2,
        fuseTime: number,
        damageType: DamageType,
        throwDir?: Vec2,
        weaponSourceType?: string,
        trainingShot?: TrainingShotToken,
    ) {
        super(game, pos);
        this.layer = layer;
        this.type = type;
        this.posZ = posZ;
        this.playerId = playerId;
        this.vel = vel;
        this.fuseTime = fuseTime;
        this.damageType = damageType;
        this.trainingShot = trainingShot;
        this.dir = v2.normalizeSafe(vel);
        this.throwDir = throwDir ?? v2.copy(this.dir);
        this.weaponSourceType = weaponSourceType || this.type;

        const def = GameObjectDefs.typeToDef(type, "throwable");
        this.velZ = def.throwPhysics.velZ;
        this.rad = def.rad * 0.5;
        this.bounds = collider.createAabbExtents(
            v2.create(0, 0),
            v2.create(this.rad, this.rad),
        );

        if (def.fuseVariance) {
            this.fuseTime += util.random(0, def.fuseVariance);
        }
    }

    updateStrobe(dt: number): void {
        if (!this.strobe) return;

        if (this.strobe.timeToPing > 0) {
            this.strobe.timeToPing -= dt;

            if (this.strobe.timeToPing <= 0) {
                this.game.playerBarn.addMapPing("ping_airstrike", this.pos);
                this.strobe.airstrikeTicker = 1;
            }
        }

        if (this.strobe.airstrikesLeft == 0) return;

        // airstrikes cannot drop until the strobe ticker is finished
        if (this.strobe.timeToPing >= 0) return;

        if (this.strobe.airstrikeTicker > 0) {
            this.strobe.airstrikeTicker -= dt;

            if (this.strobe.airstrikeTicker <= 0) {
                let rotAngle = this.strobe.rotAngle;
                if (this.strobe.airstrikesLeft % 2) {
                    rotAngle *= -1;
                }
                const nextDir = v2.rotate(this.throwDir, rotAngle);
                const newOffset = Math.ceil(
                    (this.strobe.airstrikesTotal - this.strobe.airstrikesLeft) / 2,
                ) * this.strobe.airstrikeOffset;
                const pos = v2.add(this.pos, v2.mul(nextDir, newOffset));
                this.game.planeBarn.addAirStrike(pos, this.throwDir, this.playerId);
                this.strobe.airstrikesLeft--;
                this.strobe.airstrikeTicker = this.strobe.airstrikeDelay;
            }
        }
    }

    update(dt: number) {
        if (this.strobe) {
            this.updateStrobe(dt);
        }

        const def = GameObjectDefs.typeToDef(this.type, "throwable");
        //
        // Velocity
        //

        if (this.posZ <= this.obstacleBellowHeight) {
            const isOnWater = this.game.map.isOnWater(this.pos, this.layer);
            // drag values based on plotted data from surviv
            const drag = isOnWater ? 5 : 2.3;
            this.vel = v2.mul(this.vel, 1 / (1 + dt * drag));
        }

        const posOld = v2.copy(this.pos);
        this.pos = v2.add(this.pos, v2.mul(this.vel, dt));

        if (
            this.type === "bomb_iron"
            && this.damageType === GameConfig.DamageType.Airstrike
            && this.game.map.isProtectedFromAirstrike(this.pos, this.layer, this.rad)
        ) {
            // The bomb struck an indestructible roof. Removing it without
            // creating a ground-level explosion prevents damage leaking into
            // the protected interior.
            this.destroy();
            return;
        }

        //
        // Height / posZ
        //
        this.velZ -= gravity * dt;
        this.posZ += this.velZ * dt;
        this.posZ = math.clamp(
            this.posZ,
            this.obstacleBellowHeight,
            GameConfig.projectile.maxHeight,
        );
        let height = this.posZ;
        if (def.throwPhysics.fixedCollisionHeight) {
            height = def.throwPhysics.fixedCollisionHeight;
        }

        //
        // Collision and changing layers on stair
        //
        const objs = this.game.grid.intersectGameObject(this);

        const rad = this.rad / 2;

        let insideObstacle = false;

        const velLength = math.max(v2.length(this.vel), 0.000001);

        // only do the line collision for projectiles that move more than their radius in a single tick
        const shouldDoLineCheck = (velLength * dt) > this.rad;

        for (const obj of objs) {
            if (
                obj.__type === ObjectType.Obstacle
                && util.sameLayer(this.layer, obj.layer)
                && !obj.dead
            ) {
                const intersection = collider.intersectCircle(
                    obj.collider,
                    this.pos,
                    rad,
                );
                const lineIntersection = shouldDoLineCheck
                    ? collider.intersectSegment(
                        obj.collider,
                        posOld,
                        this.pos,
                    )
                    : null;

                if (intersection || lineIntersection) {
                    if (obj.height > height) {
                        let damage = 1;
                        if (def.destroyNonCollidables && !obj.collidable) {
                            damage = 999;
                        }
                        obj.damage({
                            amount: damage,
                            damageType: this.damageType,
                            gameSourceType: this.type,
                            weaponSourceType: this.weaponSourceType,
                            source: this.game.objectRegister.getById(this.playerId),
                            mapSourceType: "",
                            dir: this.dir,
                        });

                        if (obj.dead || !obj.collidable) continue;

                        if (lineIntersection) {
                            this.pos = v2.add(
                                lineIntersection.point,
                                v2.mul(lineIntersection.normal, rad + 0.1),
                            );
                        } else if (intersection) {
                            this.pos = v2.add(
                                this.pos,
                                v2.mul(intersection.dir, intersection.pen + 0.1),
                            );
                        }

                        if (def.explodeOnImpact) {
                            this.explode();
                        } else {
                            const dir = v2.div(this.vel, velLength);
                            const normal = intersection
                                ? intersection.dir
                                : lineIntersection!.normal;
                            const dot = v2.dot(dir, normal);
                            const newDir = v2.add(v2.mul(normal, dot * -2), dir);

                            const velocityScale = math.max(1 + dot, 0.15);

                            this.vel = v2.mul(newDir, velLength * velocityScale);
                            this.dir = v2.normalizeSafe(this.vel);
                        }
                    } else if (obj.collidable) {
                        this.obstacleBellowHeight = math.max(
                            this.obstacleBellowHeight,
                            obj.height,
                        );
                        insideObstacle = true;
                    }
                }
            } else if (
                obj.__type === ObjectType.Player
                && def.playerCollision
                && !obj.dead
                && util.sameLayer(this.layer, obj.layer)
                && obj.__id !== this.playerId
            ) {
                if (coldet.testCircleCircle(this.pos, rad, obj.pos, obj.rad)) {
                    this.explode();
                }
            }
        }

        if (!insideObstacle) {
            this.obstacleBellowHeight = 0;
        }

        this.game.map.clampToMapBounds(this.pos, this.rad);

        if (this.destroyed) return;

        const originalLayer = this.layer;
        this.checkStairs(objs, 0.01);

        if (!this.dead) {
            if (this.layer !== originalLayer) {
                this.setDirty();
            } else {
                this.setPartDirty();
            }

            this.game.grid.updateObject(this);

            if (this.posZ === this.obstacleBellowHeight && def.explodeOnImpact) {
                this.explode();
            }

            //
            // Fuse time
            //

            this.fuseTime -= dt;
            if (this.fuseTime <= 0) {
                this.explode();
            }
        }
    }

    /**
     * only used for bomb_iron projectiles, they CANNOT explode inside indestructable buildings
     */
    canBombIronExplode(): boolean {
        const objs = this.game.grid.intersectGameObject(this);

        for (const obj of objs) {
            if (obj.__type != ObjectType.Building) continue;
            if (!util.sameLayer(obj.layer, this.layer)) continue;
            if (obj.wallsToDestroy < Infinity) continue; // building is destructable and bomb irons can explode on it
            for (let i = 0; i < obj.zoomRegions.length; i++) {
                const zoomRegion = obj.zoomRegions[i];

                if (
                    zoomRegion.zoomIn
                    && coldet.testCircleAabb(
                        this.pos,
                        this.rad,
                        zoomRegion.zoomIn.min,
                        zoomRegion.zoomIn.max,
                    )
                ) {
                    return false;
                }
            }
        }
        return true;
    }

    explode() {
        if (this.dead) return;
        this.dead = true;
        const def = GameObjectDefs.typeToDef(this.type, "throwable");

        if (def.splitType && def.numSplit) {
            this.game.projectileBarn.addSplitProjectiles(
                this.playerId,
                def.splitType,
                this.pos,
                this.layer,
                this.vel,
                def.numSplit,
                4,
                this.weaponSourceType,
                this.trainingShot,
            );
        }

        if (this.type == "bomb_iron" && !this.canBombIronExplode()) {
            this.destroy();
            return;
        }

        const explosionType = def.explosionType;
        if (explosionType) {
            const source = this.game.objectRegister.getById(this.playerId);
            this.game.explosionBarn.addExplosion(explosionType, this.pos, this.layer, {
                gameSourceType: this.type,
                weaponSourceType: this.weaponSourceType,
                damageType: this.damageType,
                source,
                trainingShot: this.trainingShot,
            });
        }
        this.destroy();
    }
}
