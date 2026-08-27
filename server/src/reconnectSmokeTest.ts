import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { Game } from "./game/game.ts";
import type { JoinTokenData } from "./game/game.ts";
import { NoOpSocket, ClientSocket } from "./game/socket.ts";
import type { Client } from "./game/client.ts";
import type { Player } from "./game/objects/player.ts";

/**
 * V244 全模式重连入局：
 * - 3 分钟内人物未彻底死亡即可用同一 match token 重连入局（复用玩家对象）；
 * - 最新连接视为有效：同 token 已有活跃连接时，新连接顶掉旧连接；
 * - 已阵亡真人不能重连入局；
 * - 掉线未阵亡真人不视为"没有真人"，房间不关闭（pendingHumanCount）。
 */

class RecordingSocket extends NoOpSocket<Client> {
    closeReason?: string;
    override close(reason?: string): void {
        super.close();
        this.closeReason = reason;
    }
}

const savedTokens = new Map<string, JoinTokenData>();

type PlayerLike = Player;

function makeGame(mapName: "main" | "extraction"): Game {
    return new Game(`reconnect-${mapName}-${Math.random().toString(36).slice(2)}`, {
        mapName,
        teamMode: TeamMode.Solo,
    });
}

function tokenData(game: Game, token: string): JoinTokenData & { socketId?: string } {
    return game.joinTokens.get(token)?.data as JoinTokenData & { socketId?: string };
}

function addWithToken(
    game: Game,
    token: string,
    socketId: string,
    opts: { name?: string; loadoutPriv?: string } = {},
): PlayerLike {
    const data = tokenData(game, token);
    if (data && socketId) {
        // 通过 token 数据携带模拟 socketId，便于断言绑定关系。
        data.socketId = socketId;
        savedTokens.set(`${token}:${socketId}`, data);
    }
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.joinToken = token;
    msg.matchPriv = token;
    msg.name = opts.name ?? "ReconnectHuman";
    msg.loadoutPriv = opts.loadoutPriv ?? "";
    const client = game.clientBarn.addClientWithPlayer(new RecordingSocket(), data, msg, token);
    return client?.player as PlayerLike;
}

function joinHuman(
    game: Game,
    token: string,
    socketId: string,
    opts: { uses?: number; name?: string; loadoutPriv?: string } = {},
): PlayerLike {
    game.addJoinToken(token, false, opts.uses ?? 1, 60_000, false, false, undefined);
    return addWithToken(game, token, socketId, opts);
}

/** 重连入局：复用原 match token，不再创建新 token（真实客户端只复用 matchPriv）。 */
function resumeHuman(
    game: Game,
    token: string,
    socketId: string,
    opts: { name?: string; loadoutPriv?: string; remainingUses?: number } = {},
): { player: PlayerLike | undefined; socket: RecordingSocket } {
    const socket = new RecordingSocket();
    const saved = [...savedTokens.entries()].find(([key]) => key.startsWith(`${token}:`))?.[1];
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = opts.name ?? "ReconnectHuman";
    msg.loadoutPriv = opts.loadoutPriv ?? "";
    const rebound = game.clientBarn.tryReconnectClient(
        socket,
        token,
        msg,
        saved ? ({ ...saved, socketId } as JoinTokenData) : undefined,
        opts.remainingUses,
    );
    const player = rebound
        ? (game.playerBarn.players.find(
            (candidate) => candidate.matchPriv === token && candidate.client.socket === socket,
        ) as PlayerLike | undefined)
        : undefined;
    return { player, socket };
}

void (async () => {
    const TOKEN = "reconnect-token";

    // 1) 掉线 → 同 token 重连：复用同一玩家对象，重发完整初始快照。
    {
        const game = makeGame("extraction");
        const first = joinHuman(game, TOKEN, "socket-a");
        assert(first, "human must join");
        const firstId = first.__id;
        const oldClient = first.client;
        game.clientBarn.handleSocketClose(oldClient.socket);
        assert.equal(first.disconnected, true, "disconnect marks player disconnected");
        assert.equal(game.pendingHumanCount, 1, "disconnected alive human still counts as present");

        const { player: second } = resumeHuman(game, TOKEN, "socket-b");
        assert(second, "reconnect must succeed");
        assert.equal(second.__id, firstId, "reconnect reuses the same player object");
        assert.equal(second.disconnected, false, "reconnected player is back online");
        assert.equal(game.pendingHumanCount, 0, "reconnected human no longer pending");
        // 新的 Client 连接默认携带全量快照标记（_firstUpdate），刷新/网络恢复后
        // 客户端能重建一致的世界状态。
        assert.notEqual(second.client, oldClient, "resume binds a fresh client connection");
        game.stop();
    }

    // 2) 最新连接有效：同 token（已耗尽次数）活跃连接被新连接顶掉。
    {
        const game = makeGame("extraction");
        const first = joinHuman(game, TOKEN, "socket-a");
        assert(first);
        // 不模拟掉线，直接再次加入（双开/刷新后的新标签页）。token 次数已耗尽，
        // 匿名玩家按昵称精确接管原连接，而不是生成第二个身体。
        const oldSocket = first.client.socket as RecordingSocket;
        const { player: second, socket: newSocket } = resumeHuman(game, TOKEN, "socket-c", {
            remainingUses: 0,
        });
        assert(second, "latest connection must win");
        assert.equal(second.__id, first.__id, "latest connection reuses the same player");
        assert.equal(oldSocket.closed(), true, "old active socket is closed when superseded");
        assert.notEqual(newSocket.closeReason, "invalid_token", "takeover is not a token rejection");
        assert.equal(second.disconnected, false);
        game.stop();
    }

    // 3) 人物彻底死亡后不能重连入局。
    {
        const game = makeGame("extraction");
        const human = joinHuman(game, TOKEN, "socket-a");
        assert(human);
        human.kill({
            damageType: 0,
            dir: v2.create(0, 0),
            amount: 999,
        });
        assert.equal(human.dead, true, "human is dead");
        const { player: rejected, socket } = resumeHuman(game, TOKEN, "socket-b");
        assert.equal(
            rejected === undefined || rejected.dead,
            true,
            "a dead player must not be revived into the match by reconnect",
        );
        assert.notEqual(socket.closeReason, undefined, "the reconnect attempt is refused");
        game.stop();
    }

    // 4) 搜打撤：真人掉线不限重连时间（人没死就能重连，超 3 分钟仍保留）。
    {
        const game = makeGame("extraction");
        const human = joinHuman(game, "token-unlimited", "socket-a");
        assert(human, "human must join");
        game.clientBarn.handleSocketClose(human.client.socket);
        // 模拟 10 分钟前掉线：搜打撤真人仍保留，不会被清理循环移除。
        (human as unknown as { disconnectAt: number }).disconnectAt =
            Date.now() - 1000 * 60 * 10;
        forceDisconnectCleanup(game);
        assert(
            game.playerBarn.players.includes(human),
            "extraction human is kept beyond the 3-minute window (unlimited reconnect)",
        );
        assert.equal(
            game.pendingHumanCount,
            1,
            "extraction pending human still counts toward room liveness",
        );
        const { player: again } = resumeHuman(game, "token-unlimited", "socket-b");
        assert(again, "extraction human can still reconnect after a long disconnect");
        assert.equal(again.__id, human.__id, "reconnect reuses the same player object");
        game.stop();
    }

    // 5) 普通模式：真人掉线仍受 3 分钟窗口限制，超时被移除。
    {
        const game = makeGame("main");
        const human = joinHuman(game, "token-br", "socket-a");
        assert(human, "BR human must join");
        game.clientBarn.handleSocketClose(human.client.socket);
        (human as unknown as { disconnectAt: number }).disconnectAt =
            Date.now() - 1000 * 60 * 4; // 4 分钟前掉线（超过 3 分钟窗口）
        forceDisconnectCleanup(game);
        assert(
            !game.playerBarn.players.includes(human),
            "BR human is removed after the 3-minute reconnect window",
        );
        game.stop();
    }

    // 6) 协议版本错误不能重连：错误协议不能接管原玩家对象。
    {
        const game = makeGame("extraction");
        const human = joinHuman(game, TOKEN, "socket-a");
        assert(human, "human must join");
        const firstId = human.__id;

        const badSocket = new RecordingSocket();
        const badStream = new net.MsgStream(new ArrayBuffer(64));
        const badJoin = new net.JoinMsg();
        badJoin.protocol = GameConfig.protocolVersion + 999;
        badJoin.matchPriv = TOKEN;
        badJoin.name = "ReconnectHuman";
        badStream.serializeMsg(net.MsgType.Join, badJoin);
        const raw = badStream.getBuffer();
        const packet = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
        game.clientBarn.handleMsg(packet, badSocket);

        const same = game.playerBarn.players.find((p) => p.__id === firstId);
        assert(same, "the original player object is preserved");
        assert.equal(
            same.client.socket === badSocket,
            false,
            "a wrong-protocol join must not take over the original connection",
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(badSocket.closed(), true, "bad-protocol socket is closed");
        game.stop();
    }

    // 7) 四人组队共用一个 match token：断线重连必须按账号身份精确定位，
    //    不能"夺舍"到队伍里其他玩家身上。
    {
        const game = new Game(`reconnect-squad-${Math.random().toString(36).slice(2)}`, {
            mapName: "main",
            teamMode: TeamMode.Squad,
        });
        const TOKEN4 = "squad-shared-token";
        game.addJoinToken(TOKEN4, false, 4, 60_000, false, false, undefined);
        const join = (socketId: string, name: string, loadoutPriv: string): PlayerLike => {
            const player = addWithToken(game, TOKEN4, socketId, { name, loadoutPriv });
            assert(player, `${name} must join`);
            return player;
        };
        const a = join("sock-a", "PlayerA", "account-a");
        const b = join("sock-b", "PlayerB", "account-b");
        const c = join("sock-c", "PlayerC", "account-c");
        const d = join("sock-d", "PlayerD", "account-d");
        const bId = b.__id;
        const aId = a.__id;

        // B 掉线后重连：必须回到 B 自己，绝不能接管 A（或其他人）。
        game.clientBarn.handleSocketClose(b.client.socket);
        assert.equal(b.disconnected, true, "B is marked disconnected");
        const { player: bAgain } = resumeHuman(game, TOKEN4, "sock-b2", {
            name: "PlayerB",
            loadoutPriv: "account-b",
            remainingUses: 0,
        });
        assert(bAgain, "B reconnect must succeed");
        assert.equal(bAgain.__id, bId, "B reconnects to B's own body (no body-snatch)");
        assert.equal(a.disconnected, false, "B's reconnect must not kick A's active connection");
        const aStill = game.playerBarn.players.find((p) => p.__id === aId);
        assert(aStill && aStill.disconnected === false, "A keeps its own body");

        // 身份完全对不上（名字/账号都不匹配）的重连：不能接管任何玩家。
        const { player: impostor } = resumeHuman(game, TOKEN4, "sock-x", {
            name: "Intruder",
            loadoutPriv: "account-zzz",
            remainingUses: 0,
        });
        assert.equal(
            impostor,
            undefined,
            "an unmatched identity must not take over any squad member",
        );
        game.stop();
    }

    console.log(
        "Reconnect smoke test passed: unlimited extraction reconnect (alive only), 3-min BR window, latest-connection-wins takeover, dead-player rejection, room kept alive by pending humans, bad-protocol reconnect rejection.",
    );
})().catch((error) => {
    console.error(error);
    process.exit(1);
});

/** 让下一帧 update() 立即进入断线清理分支（正常游戏由 dt 自然累积）。 */
function forceDisconnectCleanup(game: Game): void {
    (game as unknown as { disconnectCleanupTicker: number }).disconnectCleanupTicker = 1;
    game.update();
}
