import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import type { ObjectType } from "../../shared/net/objectSerializeFns.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { Game } from "./game/game.ts";
import type { Player } from "./game/objects/player.ts";

function join(game: Game, name: string): Player {
    const token = `zombie-visibility-${name}`;
    game.addJoinToken(token, false, 1, 60_000, false, false, undefined);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = name;
    msg.loadoutPriv = "";
    const player = game.playerBarn.addPlayer(`socket-${name}`, msg);
    if (!player) throw new Error(`failed to join ${name}`);
    return player;
}

function decodeUpdate(game: Game, buffer: Uint8Array): net.UpdateMsg {
    const stream = new net.MsgStream(buffer);
    assert.equal(stream.deserializeMsgType(), net.MsgType.Update, "captured packet is Update");
    const update = new net.UpdateMsg();
    update.deserialize(stream.stream, {
        getTypeById(id: number): ObjectType {
            return game.objectRegister.idToType[id] as ObjectType;
        },
    });
    return update;
}

void (async () => {
    const game = new Game(
        `zombie-visibility-${Date.now()}`,
        { mapName: "zombie", teamMode: TeamMode.Solo, zombieDifficulty: "normal" },
        () => {},
        () => {},
    );
    await game.init();
    const state = game as unknown as { started: boolean; startedTime: number; update(): void };
    state.started = true;
    state.startedTime = 0;

    try {
        const human = join(game, "VisibilityHuman");
        human.pos = v2.create(game.map.width / 2, game.map.height / 2);
        game.grid.updateObject(human);
        state.update();

        const zombies = (game.playerBarn.players as Player[]).filter(
            (player) => player.serverBot && !player.dead,
        );
        assert.equal(zombies.length, 40, "normal match starts with 40 living zombies");
        // Spawning happens at the end of the first game update. The production
        // loop refreshes player grid cells on the next tick; do the same before
        // exercising the network visibility transition.
        for (const zombie of zombies) game.grid.updateObject(zombie);

        const sent: Uint8Array[] = [];
        (human as unknown as { sendData(data: ArrayBuffer | Uint8Array): void }).sendData = (
            data,
        ) => {
            sent.push(
                data instanceof Uint8Array
                    ? Uint8Array.from(data)
                    : new Uint8Array(data.slice(0)),
            );
        };
        human._firstUpdate = false;
        human.initialFullSyncsRemaining = 0;
        human.visibleObjects.clear();
        game.playerBarn.aliveCountDirty = false;
        game.objectRegister.serializeObjs();

        const target = zombies[0];
        human.pos = v2.copy(target.pos);
        game.grid.updateObject(human);
        human.sendMsgs();
        const firstVisible = decodeUpdate(game, sent.pop()!);
        assert.ok(
            firstVisible.fullObjects.some((object) => object.__id === target.__id),
            `a zombie entering view is sent as a full client object (target=${target.__id}, full=${firstVisible.fullObjects.map((object) => object.__id).join(",")})`,
        );
        assert.ok(human.visibleObjects.has(target), "server view contains the nearby zombie");

        human.pos = v2.create(
            target.pos.x < game.map.width / 2 ? game.map.width - 5 : 5,
            target.pos.y < game.map.height / 2 ? game.map.height - 5 : 5,
        );
        game.grid.updateObject(human);
        human.sendMsgs();
        const leftView = decodeUpdate(game, sent.pop()!);
        assert.ok(
            leftView.delObjIds.includes(target.__id),
            "a zombie leaving view is explicitly removed from the client pool",
        );
        assert.ok(!human.visibleObjects.has(target), "out-of-view zombie leaves only this client view");
        assert.equal(
            game.objectRegister.getById(target.__id),
            target,
            "out-of-view zombie remains registered on the server",
        );
        assert.ok(game.playerBarn.players.includes(target), "out-of-view zombie remains in the match");
        assert.equal(target.dead, false, "out-of-view zombie is still alive");

        human.pos = v2.copy(target.pos);
        game.grid.updateObject(human);
        human.sendMsgs();
        const returned = decodeUpdate(game, sent.pop()!);
        assert.ok(
            returned.fullObjects.some((object) => object.__id === target.__id),
            "a returning zombie is recreated as a full client object",
        );

        const neverVisible: number[] = [];
        for (const zombie of zombies) {
            human.pos = v2.copy(zombie.pos);
            game.grid.updateObject(human);
            human.sendMsgs();
            sent.length = 0;
            if (!human.visibleObjects.has(zombie)) neverVisible.push(zombie.__id);
        }
        assert.deepEqual(neverVisible, [], "every spawned zombie can enter the client-visible set");
        assert.equal(
            zombies.filter((zombie) => game.objectRegister.getById(zombie.__id) === zombie).length,
            40,
            "all 40 zombies remain registered during the match",
        );

        console.log(
            "✓ zombie visibility match: 40/40 spawn, leave-view deletion, re-entry full recreation, no server-side disappearance",
        );
    } finally {
        game.stop();
    }
})();
