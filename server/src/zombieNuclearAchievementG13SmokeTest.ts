import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AchievementIds } from "../../shared/defs/achievementDefs.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { Game } from "./game/game.ts";
import type { Player } from "./game/objects/player.ts";
import { StashManager } from "./stash/stashManager.ts";

// 用法：SURVIV_DATA_DIR=<临时目录> npx tsx zombieNuclearAchievementG13SmokeTest.ts
// 由启动命令设置，config.ts 模块加载时读取 → 单例 stashManager 写入临时文件，
// 不污染生产 survivio-stash.json。

const ACCOUNT = "G13";
const sentToHuman: ArrayBuffer[] = [];

// 数据目录必须由启动命令显式指定。V257 这里默认使用 "." 并递归清空，
// 如果从 server/ 目录直接运行测试，会把整个 server 项目删除。测试属于破坏性
// 临时数据测试，因此宁可拒绝启动，也绝不能猜测清理目录。
const configuredRunDir = process.env.SURVIV_DATA_DIR?.trim();
if (!configuredRunDir) {
    throw new Error(
        "zombieNuclearAchievementG13SmokeTest requires an explicit temporary SURVIV_DATA_DIR",
    );
}
const runDir = path.resolve(configuredRunDir);
const cwd = path.resolve(process.cwd());
const projectRoot = path.resolve(__dirname, "../..");
if (
    runDir === cwd ||
    runDir === projectRoot ||
    cwd.startsWith(`${runDir}${path.sep}`) ||
    projectRoot.startsWith(`${runDir}${path.sep}`)
) {
    throw new Error(`refusing to clean unsafe SURVIV_DATA_DIR: ${runDir}`);
}
if (fs.existsSync(runDir)) {
    for (const entry of fs.readdirSync(runDir)) {
        fs.rmSync(path.join(runDir, entry), { recursive: true, force: true });
    }
}
fs.mkdirSync(runDir, { recursive: true });

const stash = new StashManager("survivio-stash.json");

function join(game: Game, token: string, name: string, account = ""): Player {
    game.addJoinToken(token, false, 1, 60_000, false, false);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = name;
    msg.loadoutPriv = account;
    const player = game.playerBarn.addPlayer(`${token}-socket`, msg);
    if (!player) throw new Error(`failed to join ${name}`);
    return player;
}

function teleport(player: Player, x: number, y: number): void {
    player.pos = v2.create(x, y);
}

void (async () => {
    const stashFile = path.join(
        process.env.SURVIV_DATA_DIR ?? ".",
        "survivio-stash.json",
    );
    console.log(`stash 文件: ${stashFile}`);

    let g13SocketId = "";
    const game = new Game(
        `g13-nuke-${Date.now()}`,
        { mapName: "zombie", teamMode: TeamMode.Solo, zombieDifficulty: "hard" },
        (socketId, data) => {
            if (socketId === g13SocketId) sentToHuman.push(data);
        },
        () => {},
    );
    try {
        await game.init();
        const g = game as unknown as {
            started: boolean;
            startedTime: number;
            update(): void;
        };
        g.started = true;
        g.startedTime = 0;

        // 账号 G13 预建仓库（与生产 key 一致），给点初始身价。
        stash.getStash(ACCOUNT);
        stash.addCoins(ACCOUNT, 100);
        console.log(`初始: ${ACCOUNT} coins=${stash.getCoins(ACCOUNT)} achievements=[]`);

        const g13 = join(game, "g13", "G13", ACCOUNT);
    g13SocketId = g13.socketId;
        assert.equal(g13.stashName, ACCOUNT, "stashName = 账号名");
        assert.equal(g13.accountAuthenticated, true, "登录玩家");
        assert.equal(
            (g13 as unknown as { zombieMissionCarriedElement: number })
                .zombieMissionCarriedElement,
            -1,
            "初始未携带元素",
        );

        // 先跑一帧让僵尸波次生成（核爆前有猎物）。
        g.update();

        const z = game.zombieMode as unknown as {
            missionElements: Array<{
                pos: { x: number; y: number };
                placed: boolean;
                carrierId: number;
            }>;
            missionDevicePos: { x: number; y: number };
            tryInteractMission(p: Player): boolean;
            armMission(): void;
            shelterCountdownEndsAt: number;
        };
        assert.ok(z.missionElements.length === 3, "3 个任务元素");

        // 模拟玩家：传送到元素 → 交互拾取 → 传送到装置 → 交互放置。
        for (let i = 0; i < z.missionElements.length; i++) {
            const element = z.missionElements[i];
            teleport(g13, element.pos.x, element.pos.y);
            assert.equal(z.tryInteractMission(g13), true, `拾取元素 ${i}`);
            assert.equal(
                (g13 as unknown as { zombieMissionCarriedElement: number })
                    .zombieMissionCarriedElement,
                i,
                `携带元素 ${i}`,
            );
            teleport(g13, z.missionDevicePos.x, z.missionDevicePos.y);
            assert.equal(z.tryInteractMission(g13), true, `放置元素 ${i}`);
            assert.equal(element.placed, true, `元素 ${i} 已放置`);
        }

        // 全部放置 → 武装完成 → 45 秒倒计时。
        (z as unknown as { armMission(): void }).armMission();
        const missionPhase = (game.zombieMode as unknown as {
            missionPhase: number;
        }).missionPhase;
        assert.equal(
            missionPhase,
            net.ZombieMissionPhase.Countdown,
            "进入倒计时",
        );

        // 玩家躲进地堡（地下层 layer 1）。
        g13.layer = 1;
        console.log("玩家已躲入地堡 (layer=1)");

        // 倒计时立即到期 → 下一帧核爆。
        z.shelterCountdownEndsAt = Date.now() - 1;
        g.update();
        // 消息在后续帧 flush 给 socket。
        for (let i = 0; i < 3; i++) g.update();

        // 验证授予 + 真实写入。
        assert.equal(
            stash.hasAchievement(ACCOUNT, AchievementIds.ZombieNuclearHard),
            true,
            "G13 成就已写入仓库",
        );
        const view = stash.publicStashView(ACCOUNT);
        assert.ok(view, "仓库视图存在");
        assert.deepEqual(
            view!.achievements,
            [AchievementIds.ZombieNuclearHard],
            "publicStashView 返回成就",
        );
        const lb = stash.leaderboard(50);
        const g13Entry = lb.find((p) => p.name === ACCOUNT);
        assert.ok(g13Entry, "G13 在排行榜");
        assert.deepEqual(
            g13Entry!.achievements,
            [AchievementIds.ZombieNuclearHard],
            "排行榜徽章包含核爆",
        );
        console.log(`排行榜 ${ACCOUNT}: coins=${g13Entry!.coins} achievements=${g13Entry!.achievements.join(",")}`);

        const unlocked = sentToHuman.some((buffer) => {
            const stream = new net.MsgStream(buffer);
            const type = stream.deserializeMsgType();
            if (type !== net.MsgType.AchievementUnlocked) {
                return false;
            }
            const msg = new net.AchievementUnlockedMsg();
            msg.deserialize(stream.stream);
            return msg.achievementId === AchievementIds.ZombieNuclearHard;
        });
        console.log(`sentToHuman buffers: ${sentToHuman.length}`);
        if (sentToHuman.length > 0) {
            const stream = new net.MsgStream(sentToHuman[0]);
            console.log(`首个 buffer msgType: ${stream.deserializeMsgType()}`);
        }
        console.log(`G13 socketId=${g13.socketId} | name=${g13.name} | stashName=${g13.stashName} | internalTrainingTarget=${(g13 as unknown as { internalTrainingTarget: boolean }).internalTrainingTarget}`);
        // 手动发一条消息验证回调链路。
        const probe = new net.AchievementUnlockedMsg();
        probe.achievementId = AchievementIds.DuelDomination;
        g13.sendMsg(net.MsgType.AchievementUnlocked, probe, 128);
        console.log(`手动发送后 sentToHuman buffers: ${sentToHuman.length}`);
        assert.equal(unlocked, true, "客户端收到成就解锁通知");

        // 幂等：重复核爆不重复授予。
        const again = stash.grantAchievement(ACCOUNT, AchievementIds.ZombieNuclearHard);
        assert.equal(again.awarded, false, "重复授予幂等");

        console.log("\n✅ G13 hard solo 核爆成就全流程实测通过：");
        console.log(`   - 传送拾取 3 元素 → 放置 → 倒计时 → 躲地堡 → 核爆`);
        console.log(`   - grantAchievement(${ACCOUNT}) → awarded=true`);
        console.log(`   - 仓库持久化: achievements=[${AchievementIds.ZombieNuclearHard}]`);
        console.log(`   - 排行榜徽章可见`);
        console.log(`   - 客户端 AchievementUnlocked 通知已发送`);
        console.log(`   - 幂等（重复不重复写入）`);
        console.log(`   - stash 文件: ${stashFile} (${fs.statSync(stashFile).size} bytes)`);
    } finally {
        game.stop();
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
