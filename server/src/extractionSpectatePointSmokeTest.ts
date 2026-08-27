import assert from "node:assert/strict";
import fs from "node:fs";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { getServerDataFilePath } from "./config.ts";
import { Game } from "./game/game.ts";
import type { JoinTokenData } from "./game/game.ts";
import { NoOpSocket } from "./game/socket.ts";
import { stashManager } from "./stash/stashManager.ts";

/**
 * V252 观战撤离点修复：观战者（spectatorOnly / 死亡观战）收到的撤离点
 * 索引应为**被观战者**的固定撤离点，而不是退化成"当前位置最远点"。
 */

function addHuman(game: Game, token: string, socketId: string) {
    game.addJoinToken(token, false, 1, 60_000, false, false, undefined);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = "SpectateTarget";
    return game.clientBarn.addClientWithPlayer(
        new NoOpSocket(),
        game.joinTokens.get(token)?.data as JoinTokenData,
        msg,
        token,
    )?.player;
}

function addSpectator(game: Game, token: string, socketId: string) {
    game.addJoinToken(token, false, 1, 60_000, true, false, undefined);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = "Spectator";
    return game.clientBarn.addClientWithPlayer(
        new NoOpSocket(),
        game.joinTokens.get(token)?.data as JoinTokenData,
        msg,
        token,
    )?.player;
}

const realStashFile = getServerDataFilePath("survivio-stash.json");
const stashBackupFile = getServerDataFilePath("survivio-spectate-test-backup.json");
if (fs.existsSync(realStashFile)) fs.copyFileSync(realStashFile, stashBackupFile);

void (async () => {
    try {
        const game = new Game(`extraction-spectate-${Math.random().toString(36).slice(2)}`, {
            mapName: "extraction",
            teamMode: TeamMode.Solo,
        });

        const target = addHuman(game, "target-token", "t-socket");
        assert(target, "target human joins");
        const spectator = addSpectator(game, "spec-token", "s-socket");
        assert(spectator, "spectator joins");
        assert.equal(spectator.spectatorOnly, true);
        assert.equal(spectator.spectating, target, "spectator watches the target");

        // 触发一次 extraction sync（约 0.2s）：update 内部用 performance.now()
        // 计算 dt，每帧前把时钟拨回 100ms，让 dt 稳定累积。
        for (let i = 0; i < 12; i++) {
            (game as unknown as { now: number }).now = performance.now() - 100;
            game.update();
        }

        const expectedIndex = game.extraction().pointIndexFor(target);
        const pointMsg = spectator.client.msgsToSend.find(
            (entry) => entry.type === net.MsgType.ExtractionPoint,
        );
        assert(pointMsg, "spectator must receive an extraction point sync");
        const msg = pointMsg.msg as net.ExtractionPointMsg;
        assert.equal(
            msg.pointIndex,
            expectedIndex,
            "spectator receives the target's fixed extraction point index",
        );
        assert.equal(
            msg.pointIndex >= 0 && msg.pointIndex < 5,
            true,
            "extraction point index is valid",
        );

        // 观战加入绝不消耗玩家仓库配装：通过 handleMsg 走完整加入路径，
        // 观战者（spectatorOnly）不得触发 applyExtractionSpawnLoadout。
        const STASH_NAME = "SpecLoadout";
        stashManager.addItem(STASH_NAME, "groza", 2);
        stashManager.setLoadout(STASH_NAME, {
            guns: ["groza", ""],
            ammo: {},
            consumables: {},
            throwables: {},
            armor: {},
        });
        const gunsBefore = Number(
            stashManager.getStash(STASH_NAME).items.guns.groza ?? 0,
        );
        game.addJoinToken(
            "spec-loadout-token",
            false,
            1,
            60_000,
            true,
            false,
            undefined,
        );
        const specJoin = new net.JoinMsg();
        specJoin.protocol = GameConfig.protocolVersion;
        specJoin.matchPriv = "spec-loadout-token";
        specJoin.name = STASH_NAME;
        const specStream = new net.MsgStream(new ArrayBuffer(4096));
        specStream.serializeMsg(net.MsgType.Join, specJoin);
        const raw = specStream.getBuffer();
        const packet = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
        game.clientBarn.handleMsg(packet, new NoOpSocket());
        const specPlayer = game.playerBarn.players.find(
            (candidate) => candidate.name === STASH_NAME,
        );
        assert(specPlayer, "spectator joins via handleMsg");
        assert.equal(specPlayer.spectatorOnly, true);
        assert.equal(
            (
                specPlayer as unknown as {
                    extractionLoadoutGranted: boolean;
                }
            ).extractionLoadoutGranted,
            false,
            "spectator must NOT be granted a bring-in loadout",
        );
        const gunsAfter = Number(
            stashManager.getStash(STASH_NAME).items.guns.groza ?? 0,
        );
        assert.equal(
            gunsAfter,
            gunsBefore,
            "spectating must NOT consume the player's stash equipment",
        );

        game.stop();

        console.log(
            "Extraction spectate point smoke test passed: spectator receives the watched player's fixed extraction point and never consumes the stash loadout.",
        );
    } finally {
        // 恢复真实仓库文件并清理备份。
        try {
            if (fs.existsSync(stashBackupFile)) {
                fs.copyFileSync(stashBackupFile, realStashFile);
            }
            fs.rmSync(stashBackupFile, { force: true });
        } catch {
            // 恢复失败不掩盖测试结果。
        }
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
