import { RawGameObjectDefs as GameObjectDefs } from "../../../shared/defs/gameObjectDefs.ts";
import { ExplosionDefs } from "../../../shared/defs/gameObjects/explosionsDefs.ts";
import type { GunDef } from "../../../shared/defs/gameObjects/gunDefs.ts";
import type { ThrowableDef } from "../../../shared/defs/gameObjects/throwableDefs.ts";
import { RawMapObjectDefs as MapObjectDefs } from "../../../shared/defs/mapObjectDefs.ts";
import type { ObstacleDef } from "../../../shared/defs/mapObjectsTyping.ts";
import { GameConfig } from "../../../shared/gameConfig.ts";
import { ObjectType } from "../../../shared/net/objectSerializeFns.ts";
import { collider } from "../../../shared/utils/collider.ts";
import { util } from "../../../shared/utils/util.ts";
import { v2, type Vec2 } from "../../../shared/utils/v2.ts";
import type { Game } from "../game/game.ts";
import type { Obstacle } from "../game/objects/obstacle.ts";
import { getStrobeAirstrikeIntervalMs, getStrobeAirstrikeOffsets } from "../game/objects/projectile.ts";
import { pointInsideViewport, viewportForMaxScope } from "./combatIntelligence.ts";
import type { ForbiddenContextSnapshot, ForbiddenDifficulty, ForbiddenPlayerSnapshot } from "./forbiddenCombat.ts";

function directShotClear(game: Game, from: Vec2, to: Vec2, layer: number): boolean {
    const objects = game.grid.intersectLineSegment(from, to);
    for (const object of objects) {
        if (object.__type !== ObjectType.Obstacle) continue;
        const obstacle = object as Obstacle;
        if (
            obstacle.dead
            || !obstacle.collidable
            || obstacle.height < GameConfig.bullet.height
            || !util.sameLayer(obstacle.layer, layer)
        ) {
            continue;
        }
        if (collider.intersectSegment(obstacle.collider, from, to)) return false;
    }
    return true;
}

function legitViewportContains(
    bot: Game["playerBarn"]["players"][number],
    point: Vec2,
    margin = 0,
): boolean {
    return pointInsideViewport(
        bot.pos,
        point,
        viewportForMaxScope(bot.pos, bot.zoom, bot.scope, bot.inventory),
        margin,
    );
}

function pointToSegmentDistance(point: Vec2, start: Vec2, end: Vec2): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= 0.000001) return Math.hypot(point.x - start.x, point.y - start.y);
    const t = Math.max(
        0,
        Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq),
    );
    const closestX = start.x + dx * t;
    const closestY = start.y + dy * t;
    return Math.hypot(point.x - closestX, point.y - closestY);
}

function smokeBlocksVision(
    game: Game,
    from: Vec2,
    to: Vec2,
    layer: number,
): boolean {
    if (Math.hypot(to.x - from.x, to.y - from.y) <= 3.8) return false;
    return game.smokeBarn.smokes.some((smoke) => {
        if (smoke.destroyed || !util.sameLayer(smoke.layer, layer)) return false;
        return pointToSegmentDistance(smoke.pos, from, to) <= Math.max(0.5, smoke.rad * 0.92);
    });
}

function targetHiddenInBush(
    game: Game,
    bot: Game["playerBarn"]["players"][number],
    target: Game["playerBarn"]["players"][number],
): boolean {
    if (Math.hypot(target.pos.x - bot.pos.x, target.pos.y - bot.pos.y) <= 3.8) return false;
    for (const obstacle of game.map.obstacles) {
        if (obstacle.dead || !util.sameLayer(obstacle.layer, target.layer)) continue;
        const def = MapObjectDefs[obstacle.type] as ObstacleDef & { isBush?: boolean };
        if (!def?.isBush) continue;
        const targetInside = collider.intersectCircle(
            obstacle.collider,
            target.pos,
            GameConfig.player.radius * 0.55,
        );
        if (!targetInside) continue;
        const botInside = collider.intersectCircle(
            obstacle.collider,
            bot.pos,
            GameConfig.player.radius * 0.55,
        );
        if (!botInside) return true;
    }
    return false;
}

/**
 * Server-side perception gate for the LEGIT difficulty. The first authority is
 * the same visible-object set serialized to the normal game client. The extra
 * viewport/layer and concealment checks prevent stale edge objects, smoke and
 * bushes from leaking a live snapshot. Physical bullet cover is deliberately
 * not treated as invisibility: a human can still see an on-screen opponent
 * standing behind a sandbag or rock and reason about that cover.
 */
export function legitPlayerVisible(
    game: Game,
    bot: Game["playerBarn"]["players"][number],
    target: Game["playerBarn"]["players"][number],
): boolean {
    if (target.dead || target.disconnected || target.spectatorOnly) return false;
    if (!bot.client.visibleObjects.has(target)) return false;
    if (!util.sameLayer(bot.layer, target.layer)) return false;
    if (!legitViewportContains(bot, target.pos, -0.35)) return false;
    if (smokeBlocksVision(game, bot.pos, target.pos, bot.layer)) return false;
    if (targetHiddenInBush(game, bot, target)) return false;
    return true;
}

function playerSnapshot(
    game: Game,
    player: Game["playerBarn"]["players"][number],
    botPos: Vec2 | null,
    botLayer: number,
): ForbiddenPlayerSnapshot {
    const lineClearFromBot = botPos
        ? directShotClear(game, botPos, player.pos, botLayer)
        : false;
    const activeDef = GameObjectDefs[player.activeWeapon] as GunDef | undefined;
    const currentSpeed = Math.hypot(player.moveVel.x, player.moveVel.y);
    const attackSpeed = activeDef?.type === "gun"
        ? Number(activeDef.speed.attack ?? 0)
        : 0;
    const postSlowdownSpeed = player.shotSlowdownTimer > 0 && currentSpeed > 0.01
        ? Math.max(0, currentSpeed * 2 - attackSpeed)
        : currentSpeed;
    return {
        id: player.__id,
        pos: v2.copy(player.pos),
        velocity: v2.copy(player.moveVel),
        dir: v2.copy(player.dir),
        layer: player.layer,
        health: player.health,
        dead: player.dead || player.disconnected,
        downed: player.downed,
        activeWeapon: player.activeWeapon,
        curWeapIdx: player.curWeapIdx,
        weapons: player.weapons.map((weapon) => ({
            type: weapon.type,
            ammo: weapon.ammo,
            cooldown: weapon.cooldown,
            recoilTime: weapon.recoilTime,
        })),
        actionType: player.actionType,
        actionItem: player.actionItem,
        actionTime: player.action.time,
        actionDuration: player.action.duration,
        zoom: player.zoom,
        indoors: player.indoors,
        lineClearFromBot,
        shotSlowdownTimer: Math.max(0, player.shotSlowdownTimer),
        postSlowdownSpeed,
    };
}

export function buildForbiddenContext(
    game: Game,
    botPlayerId: number,
    sequence: number,
    difficulty: ForbiddenDifficulty = "forbidden",
): ForbiddenContextSnapshot {
    const bot = game.playerBarn.players.find((player) => player.__id === botPlayerId) ?? null;
    const botPos = bot ? bot.pos : null;
    const botLayer = bot?.layer ?? 0;
    const lineOfSightOnly = difficulty === "legit";
    // 搜打撤：AI 只把真人视为敌人，AI 之间不互攻（杜绝自相残杀），
    // 同时让所有 AI 把真人当作唯一目标集中追击。
    const extractionMode = Boolean(game.map.mapDef.gameMode.extractionMode);
    const playersAreAllies = (
        candidate: Game["playerBarn"]["players"][number],
    ): boolean => {
        if (!bot) return false;
        // 搜打撤中所有 AI 集中追击真人，AI 之间不互攻。普通组队和
        // 阵营模式按实际 teamId 排除队友，避免高阶控制器瞄准本队。
        if (extractionMode) return candidate.serverBot;
        return Boolean(
            (game.isTeamMode || game.map.factionMode)
                && bot.teamId > 0
                && candidate.teamId === bot.teamId,
        );
    };
    const enemies = game.playerBarn.players
        .filter(
            (player) =>
                player.__id !== botPlayerId
                && !player.spectatorOnly
                && !player.disconnected
                && !playersAreAllies(player)
                && (!lineOfSightOnly || Boolean(bot && legitPlayerVisible(game, bot, player))),
        )
        .map((player) => playerSnapshot(game, player, botPos, botLayer));
    // Combat never needs every collider on a 720x720 map. Serializing the full
    // obstacle array for every LEGIT bot every few milliseconds created multi-GB
    // IPC churn in ordinary/extraction matches. The active camera and every
    // legal direct/ricochet shot fit inside this local combat window.
    const localObstacleRadius = bot
        ? Math.max(120, Math.min(240, Number(bot.zoom || 28) * 2.5 + 64))
        : 0;
    const localObstacleRadiusSq = localObstacleRadius * localObstacleRadius;
    const obstacleIsLocallyRelevant = (obstacle: Obstacle): boolean => {
        if (!botPos) return false;
        const dx = obstacle.pos.x - botPos.x;
        const dy = obstacle.pos.y - botPos.y;
        return dx * dx + dy * dy <= localObstacleRadiusSq;
    };

    return {
        type: "forbidden-context",
        perception: lineOfSightOnly ? "line-of-sight" : "omniscient",
        sequence,
        generatedAt: Date.now(),
        gameId: game.id,
        mapName: game.mapName,
        mapWidth: game.map.width,
        mapHeight: game.map.height,
        botPlayerId,
        bot: bot ? playerSnapshot(game, bot, botPos, botLayer) : null,
        enemies,
        bullets: game.bulletBarn.bullets
            .filter(
                (bullet) =>
                    bullet.alive
                    && (!lineOfSightOnly
                        || Boolean(
                            bot
                                && util.sameLayer(bullet.layer, bot.layer)
                                && legitViewportContains(bot, bullet.pos, 1.25),
                        )),
            )
            .map((bullet) => {
                const def = GameObjectDefs[bullet.bulletType] as unknown as Record<string, unknown>;
                return {
                    id: bullet.forbiddenTrackingId,
                    playerId: bullet.playerId,
                    pos: v2.copy(bullet.pos),
                    dir: v2.copy(bullet.dir),
                    speed: bullet.speed,
                    damage: Number(def?.damage ?? bullet.damage ?? 0),
                    remainingDistance: Math.max(0, bullet.maxDistance - bullet.distanceTraveled),
                    bulletType: bullet.bulletType,
                    layer: bullet.layer,
                };
            }),
        projectiles: game.projectileBarn.projectiles
            .filter(
                (projectile) =>
                    !projectile.dead
                    && !projectile.destroyed
                    && (!lineOfSightOnly
                        || Boolean(
                            bot
                                && util.sameLayer(projectile.layer, bot.layer)
                                && legitViewportContains(bot, projectile.pos, 2),
                        )),
            )
            .map((projectile) => {
                const def = GameObjectDefs[projectile.type] as ThrowableDef;
                const ageSeconds = Math.max(0, (Date.now() - projectile.createdAtMs) / 1000);
                const strikeDelay = projectile.type === "strobe"
                    ? Number(def.strikeDelay ?? 0) - ageSeconds
                    : 0;
                const source = game.objectRegister.getById(projectile.playerId);
                const brokenArrow = projectile.type === "strobe"
                    && source?.__type === ObjectType.Player
                    && source.hasPerk("broken_arrow");
                const strobeOffsets = projectile.type === "strobe"
                    ? getStrobeAirstrikeOffsets(brokenArrow)
                    : [];
                return {
                    playerId: projectile.playerId,
                    pos: v2.copy(projectile.pos),
                    velocity: v2.copy(projectile.vel),
                    dir: v2.copy(projectile.dir),
                    fuseTime: projectile.fuseTime,
                    type: projectile.type,
                    layer: projectile.layer,
                    strikeTime: strikeDelay,
                    strikeDuration: projectile.type === "strobe"
                        ? 1.65
                            + Math.max(0, strobeOffsets.length - 1)
                                * (getStrobeAirstrikeIntervalMs(brokenArrow) / 1000)
                        : 0,
                    strikeRadius: projectile.type === "strobe"
                        ? brokenArrow
                            ? 34
                            : 17
                        : projectile.type === "bomb_iron"
                        ? 8
                        : 0,
                };
            }),
        obstacles: game.map.obstacles
            .filter(
                (obstacle) =>
                    !obstacle.dead
                    && obstacle.collidable
                    && obstacleIsLocallyRelevant(obstacle),
            )
            .map((obstacle) => {
                const def = MapObjectDefs[obstacle.type] as ObstacleDef;
                const explosion = def.explosion ? ExplosionDefs[def.explosion] : undefined;
                const coll = obstacle.collider;
                return {
                    id: obstacle.__id,
                    type: obstacle.type,
                    pos: v2.copy(obstacle.pos),
                    layer: obstacle.layer,
                    height: obstacle.height,
                    health: obstacle.health,
                    maxHealth: obstacle.maxHealth,
                    healthT: obstacle.healthT,
                    dead: obstacle.dead,
                    collidable: obstacle.collidable,
                    destructible: obstacle.destructible,
                    armorPlated: Boolean(def.armorPlated),
                    stonePlated: Boolean(def.stonePlated),
                    reflectBullets: Boolean(def.reflectBullets),
                    explosionType: def.explosion ?? "",
                    explosionRadius: Number(explosion?.rad.max ?? 0),
                    collider: coll.type === 0
                        ? { type: 0 as const, pos: v2.copy(coll.pos), rad: coll.rad }
                        : { type: 1 as const, min: v2.copy(coll.min), max: v2.copy(coll.max) },
                };
            }),
    };
}
