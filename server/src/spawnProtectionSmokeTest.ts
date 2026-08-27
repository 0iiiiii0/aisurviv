import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Config } from "./config.ts";
import { Game } from "./game/game.ts";
import { Player, type Player as PlayerType } from "./game/objects/player.ts";

const previousSecret = JSON.parse(
    JSON.stringify(Config.extractionSecret),
) as typeof Config.extractionSecret;
Config.extractionSecret.enabled = false;

function addTokenAndJoin(game: Game, name: string, socketId: string): PlayerType {
    const token = `spawn-protect-${name}-${socketId}`;
    game.addJoinToken(token, false, 1, 60_000, false, false, undefined);
    const join = new net.JoinMsg();
    join.protocol = GameConfig.protocolVersion;
    join.matchPriv = token;
    join.name = name;
    join.loadoutPriv = "";
    const player = game.playerBarn.addPlayer(socketId, join);
    if (!player) throw new Error(`failed to join ${name}`);
    return player;
}

function sendJoin(game: Game, token: string, name: string, socketId: string): void {
    const join = new net.JoinMsg();
    join.protocol = GameConfig.protocolVersion;
    join.matchPriv = token;
    join.name = name;
    join.loadoutPriv = "";
    const stream = new net.MsgStream(new ArrayBuffer(512));
    stream.serializeMsg(net.MsgType.Join, join);
    const bytes = stream.getBuffer().slice();
    game.handleMsg(bytes.buffer, socketId);
}

function joinThroughAuthoritativePath(
    game: Game,
    name: string,
    socketId: string,
): PlayerType {
    const token = `spawn-protect-${name}-${socketId}`;
    game.addJoinToken(token, false, 1, 60_000, false, false, undefined);
    sendJoin(game, token, name, socketId);
    const player = game.playerBarn.socketIdToPlayer.get(socketId);
    if (!player) throw new Error(`authoritative join failed for ${name}`);
    return player;
}

function activeInput(mutator: (message: net.InputMsg) => void): net.InputMsg {
    const input = new net.InputMsg();
    input.seq = 1;
    mutator(input);
    return input;
}

function assertDamageBlocked(player: PlayerType): void {
    const health = player.health;
    player.damage({
        amount: 50,
        damageType: GameConfig.DamageType.Player,
        dir: { x: -1, y: 0 },
        source: undefined,
    });
    assert.equal(player.health, health, "damage must be blocked during protection");
}

void (async () => {
    const extraction = new Game(
        `late-join-extraction-${Math.random().toString(36).slice(2)}`,
        { mapName: "extraction", teamMode: TeamMode.Solo },
        () => {},
        () => {},
    );
    const normal = new Game(
        `late-join-normal-${Math.random().toString(36).slice(2)}`,
        { mapName: "main", teamMode: TeamMode.Solo },
        () => {},
        () => {},
    );
    await extraction.init();
    await normal.init();

    try {
        // 开局前加入的搜打撤玩家不应获得保护。
        const early = joinThroughAuthoritativePath(extraction, "Early", "early-socket");
        assert.equal(early.spawnProtectionUntil, 0);

        extraction.started = true;
        extraction.startedTime = 1;
        const late = joinThroughAuthoritativePath(extraction, "Late", "late-socket");
        const remaining = late.spawnProtectionUntil - Date.now();
        assert.ok(remaining > 4500 && remaining <= Player.lateJoinProtectionDurationMs);
        assertDamageBlocked(late);

        // 纯瞄准/空 InputMsg 不属于行为，不取消保护。
        late.handleInput(activeInput((input) => {
            input.toMouseDir = { x: 0, y: 1 };
        }));
        assert.equal(late.spawnProtectionActive, true);

        const cancelCases: Array<{
            name: string;
            input: (message: net.InputMsg) => void;
        }> = [
            { name: "keyboard movement", input: (message) => { message.moveLeft = true; } },
            { name: "touch movement", input: (message) => { message.touchMoveActive = true; } },
            { name: "shoot start", input: (message) => { message.shootStart = true; } },
            { name: "shoot hold", input: (message) => { message.shootHold = true; } },
            { name: "healing item", input: (message) => { message.useItem = "bandage"; } },
            {
                name: "weapon/reload/interact action",
                input: (message) => { message.inputs = [GameConfig.Input.Reload]; },
            },
        ];
        for (const testCase of cancelCases) {
            late.grantLateJoinProtection();
            late.handleInput(activeInput(testCase.input));
            assert.equal(
                late.spawnProtectionActive,
                false,
                `${testCase.name} must cancel protection immediately`,
            );
        }

        // DropItem 等非 Input 主动消息也必须解除。
        late.grantLateJoinProtection();
        const drop = new net.DropItemMsg();
        drop.item = "bandage";
        const dropStream = new net.MsgStream(new ArrayBuffer(128));
        dropStream.serializeMsg(net.MsgType.DropItem, drop);
        const dropBytes = dropStream.getBuffer().slice();
        extraction.handleMsg(dropBytes.buffer, "late-socket");
        assert.equal(late.spawnProtectionActive, false);

        late.health = 100;
        late.damage({
            amount: 25,
            damageType: GameConfig.DamageType.Player,
            dir: { x: -1, y: 0 },
            source: undefined,
        });
        assert.equal(late.health, 75, "damage resumes after the player acts");

        // 断线重连只能恢复同一个角色，不能借此重新领取5秒保护。
        late.cancelSpawnProtection();
        extraction.handleSocketClose("late-socket");
        sendJoin(
            extraction,
            "spawn-protect-Late-late-socket",
            "Late",
            "late-reconnect-socket",
        );
        const reconnected = extraction.playerBarn.socketIdToPlayer.get(
            "late-reconnect-socket",
        );
        assert.equal(reconnected, late, "reconnect must resume the original Player");
        assert.equal(
            late.spawnProtectionUntil,
            0,
            "reconnect must not refresh late-join protection",
        );

        // 非搜打撤模式即使已开局，后加入也不能拿到此保护。
        addTokenAndJoin(normal, "NormalEarly", "normal-early");
        normal.started = true;
        normal.startedTime = 1;
        const normalLate = joinThroughAuthoritativePath(
            normal,
            "NormalLate",
            "normal-late",
        );
        assert.equal(normalLate.spawnProtectionUntil, 0);

        // 到期后 getter 与 update 均不再判定为保护。
        late.grantLateJoinProtection();
        late.spawnProtectionUntil = Date.now() - 1;
        late.update(0.01, 0.01);
        assert.equal(late.spawnProtectionUntil, 0);

        console.log(
            "Spawn protection test passed: extraction late joins get 5s; all active behavior cancels it; normal modes do not receive it.",
        );
    } finally {
        extraction.stop();
        normal.stop();
        Config.extractionSecret = previousSecret;
    }
})();
