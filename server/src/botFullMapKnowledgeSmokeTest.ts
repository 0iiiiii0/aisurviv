import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { ObjectType } from "../../shared/net/objectSerializeFns.ts";
import { collider } from "../../shared/utils/collider.ts";
import {
    FullMapPathPlanner,
    type FullMapPathObstacle,
} from "./bot/fullMapPathPlanner.ts";
import {
    type NavigationBlocker,
    planLocalSteering,
} from "./bot/navigationController.ts";
import { ObjectPool } from "./bot/smartBotSupport.ts";
import type { Client } from "./game/client.ts";
import { Game, type JoinTokenData } from "./game/game.ts";
import { ClientSocket } from "./game/socket.ts";

class CapturingSocket extends ClientSocket<Client> {
    packets: Uint8Array[] = [];
    private isClosed = false;

    ip(): string {
        return "127.0.0.1";
    }

    closed(): boolean {
        return this.isClosed;
    }

    send(data: Uint8Array<ArrayBuffer>): void {
        this.packets.push(Uint8Array.from(data));
    }

    close(): void {
        this.isClosed = true;
    }
}

const join = (
    game: Game,
    socket: CapturingSocket,
    token: string,
    name: string,
    serverBot: boolean,
    botMapOwner = serverBot,
): void => {
    game.addJoinToken(token, true, 1, 60_000, false, serverBot);
    const joinData = game.joinTokens.get(token)?.data as JoinTokenData;
    const message = new net.JoinMsg();
    message.protocol = GameConfig.protocolVersion;
    message.joinToken = token;
    message.matchPriv = token;
    message.name = name;
    message.bot = serverBot;
    message.botMapOwner = botMapOwner;
    assert.ok(
        game.clientBarn.addClientWithPlayer(socket, joinData, message, token)?.player,
        `${name} must join`,
    );
};

const fullObstacleCount = (packet: Uint8Array): number => {
    const stream = new net.MsgStream(packet);
    const pool = new ObjectPool();
    let count = 0;
    while (true) {
        const type = stream.deserializeMsgType();
        if (type === net.MsgType.None) break;
        switch (type) {
            case net.MsgType.Joined:
                new net.JoinedMsg().deserialize(stream.getStream());
                break;
            case net.MsgType.Map:
                new net.MapMsg().deserialize(stream.getStream());
                break;
            case net.MsgType.AliveCounts:
                new net.AliveCountsMsg().deserialize(stream.getStream());
                break;
            case net.MsgType.Update: {
                const update = new net.UpdateMsg();
                update.deserialize(stream.getStream(), pool);
                for (const object of update.fullObjects) {
                    pool.updateObjFull(object.__type, object.__id, object);
                    if (object.__type === ObjectType.Obstacle) count++;
                }
                break;
            }
            default:
                throw new Error(`unexpected first-packet message ${type}`);
        }
        stream.getStream().readAlignToNextByte();
    }
    return count;
};

const game = new Game("bot-full-map-knowledge", {
    mapName: "main",
    teamMode: TeamMode.Duo,
});
const botSocket = new CapturingSocket();
const sharedBotSocket = new CapturingSocket();
const humanSocket = new CapturingSocket();
join(game, botSocket, "full-map-bot", "FullMapBot", true);
join(game, sharedBotSocket, "shared-map-bot", "SharedMapBot", true, false);
join(game, humanSocket, "local-human", "LocalHuman", false);
game.netSync();

assert.equal(botSocket.packets.length, 1);
assert.equal(sharedBotSocket.packets.length, 1);
assert.equal(humanSocket.packets.length, 1);
const botObstacleCount = fullObstacleCount(botSocket.packets[0]);
const sharedBotObstacleCount = fullObstacleCount(sharedBotSocket.packets[0]);
const humanObstacleCount = fullObstacleCount(humanSocket.packets[0]);
assert.ok(
    botObstacleCount >= game.map.obstacles.length,
    `bot must receive the complete generated obstacle map (${botObstacleCount}/${game.map.obstacles.length})`,
);
assert.ok(
    humanObstacleCount < game.map.obstacles.length,
    "human clients must remain limited to ordinary viewport culling",
);
assert.ok(
    sharedBotObstacleCount < game.map.obstacles.length,
    "non-owner bots must reuse the coordinator world instead of downloading it again",
);
assert.ok(
    sharedBotSocket.packets[0].byteLength < botSocket.packets[0].byteLength,
    "a shared-world bot first packet must be smaller than the map owner's packet",
);
assert.ok(
    botSocket.packets[0].byteLength > humanSocket.packets[0].byteLength,
    "the larger full-map packet must be isolated to the server bot",
);

const generatedNavigationObstacles: FullMapPathObstacle[] = game.map.obstacles
    .filter((obstacle) => obstacle.collidable && !obstacle.dead)
    .map((obstacle) => ({
        id: obstacle.__id,
        layer: obstacle.layer,
        collision: obstacle.collider.type === collider.Type.Circle
            ? {
                type: 0 as const,
                pos: obstacle.collider.pos,
                rad: obstacle.collider.rad,
            }
            : {
                type: 1 as const,
                min: obstacle.collider.min,
                max: obstacle.collider.max,
            },
        openableDoor: Boolean(
            obstacle.isDoor
                && obstacle.door?.canUse
                && !obstacle.door.locked,
        ),
    }));
const generatedMapPlanner = new FullMapPathPlanner({
    width: game.map.width,
    height: game.map.height,
    obstacles: generatedNavigationObstacles,
    cellSize: 2.5,
    // Keep a movement-step corridor around globally planned turns. The local
    // executor may advance a waypoint from up to 0.45 units away.
    clearance: GameConfig.player.radius + 0.58,
});
const generatedMapRoute = generatedMapPlanner.plan(
    { x: 20, y: 20 },
    { x: game.map.width - 20, y: game.map.height - 20 },
    0,
);
assert.ok(
    generatedMapRoute?.waypoints.length,
    "the planner must find a long route across a real densely generated map",
);

const openedGeneratedDoors = new Set<number>();
let generatedPosition = { x: 20, y: 20 };
let generatedWaypointIndex = 0;
let generatedAvoidanceEvents = 0;
const generatedAvoidanceBlockerIds = new Set<number>();
let firstGeneratedAvoidance: Record<string, unknown> | null = null;
let generatedMovementFrames = 0;
for (
    ;
    generatedMovementFrames < 20_000
        && generatedWaypointIndex < generatedMapRoute.waypoints.length;
    generatedMovementFrames++
) {
    const waypoint = generatedMapRoute.waypoints[generatedWaypointIndex];
    if (Math.hypot(generatedPosition.x - waypoint.x, generatedPosition.y - waypoint.y) <= 0.45) {
        generatedWaypointIndex++;
        continue;
    }
    const blockers: NavigationBlocker[] = generatedNavigationObstacles
        .filter((obstacle) => (obstacle.layer & 0x1) === 0)
        .filter((obstacle) => !openedGeneratedDoors.has(obstacle.id))
        .map((obstacle) => ({
            id: obstacle.id,
            pos: obstacle.collision.type === 0
                ? obstacle.collision.pos
                : {
                    x: (obstacle.collision.min.x + obstacle.collision.max.x) * 0.5,
                    y: (obstacle.collision.min.y + obstacle.collision.max.y) * 0.5,
                },
            radius: obstacle.collision.type === 0
                ? obstacle.collision.rad
                : Math.hypot(
                    obstacle.collision.max.x - obstacle.collision.min.x,
                    obstacle.collision.max.y - obstacle.collision.min.y,
                ) * 0.5,
            collision: obstacle.collision,
            openableDoor: obstacle.openableDoor,
        }));
    const local = planLocalSteering(generatedPosition, waypoint, blockers, {
        clearance: GameConfig.player.radius + 0.18,
        preferredSide: 1,
        bounds: {
            minX: 1,
            minY: 1,
            maxX: game.map.width - 1,
            maxY: game.map.height - 1,
        },
    });
    if (local.blocked && local.approachDoor) {
        const door = blockers.find((blocker) => blocker.id === local.blockerId);
        if (door && Math.hypot(generatedPosition.x - door.pos.x, generatedPosition.y - door.pos.y) <= 4.35) {
            openedGeneratedDoors.add(door.id);
        }
    } else if (local.blocked) {
        generatedAvoidanceEvents++;
        generatedAvoidanceBlockerIds.add(local.blockerId);
        if (!firstGeneratedAvoidance) {
            const obstacle = game.map.obstacles.find((candidate) => candidate.__id === local.blockerId);
            firstGeneratedAvoidance = {
                frame: generatedMovementFrames,
                position: generatedPosition,
                waypointIndex: generatedWaypointIndex,
                waypoint,
                localWaypoint: local.waypoint,
                blockerId: local.blockerId,
                blockerType: obstacle?.type,
                blockerLayer: obstacle?.layer,
                blockerPosition: obstacle?.pos,
                blockerCollider: obstacle?.collider,
                blockerDoor: obstacle?.isDoor,
            };
        }
    }
    generatedPosition = {
        x: generatedPosition.x + local.direction.x * 0.34,
        y: generatedPosition.y + local.direction.y * 0.34,
    };
}
assert.equal(
    generatedWaypointIndex,
    generatedMapRoute.waypoints.length,
    "the simulated bot must finish the real-map long-distance route: "
        + JSON.stringify({
            generatedPosition,
            generatedWaypointIndex,
            nextWaypoint: generatedMapRoute.waypoints[generatedWaypointIndex],
            generatedMovementFrames,
            generatedAvoidanceEvents,
            generatedAvoidanceBlockerIds: [...generatedAvoidanceBlockerIds],
            openedGeneratedDoors: [...openedGeneratedDoors],
        }),
);
assert.equal(
    generatedAvoidanceEvents,
    0,
    "a real generated-map route must not trigger ordinary local avoidance: "
        + JSON.stringify({
            generatedAvoidanceEvents,
            generatedAvoidanceBlockerIds: [...generatedAvoidanceBlockerIds],
            firstGeneratedAvoidance,
        }),
);

game.stop();
console.log(
    `Bot full-map knowledge smoke test passed: owner=${botObstacleCount}, `
        + `shared-visible=${sharedBotObstacleCount}, human-visible=${humanObstacleCount}, `
        + `generated=${game.map.obstacles.length}, `
        + `route-waypoints=${generatedMapRoute.waypoints.length}, `
        + `movement-frames=${generatedMovementFrames}, ordinaryAvoidance=0.`,
);
