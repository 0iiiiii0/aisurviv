import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AchievementIds } from "../../shared/defs/achievementDefs.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Game } from "./game/game.ts";
import { prepareEmptySmokeTestDataDir } from "./smokeTestDataDir.ts";
import type { Player } from "./game/objects/player.ts";
import { stashManager } from "./stash/stashManager.ts";

// 用法：SURVIV_DATA_DIR=<临时目录> npx tsx duelDominationG13SmokeTest.ts
// 真实 stash 单例（临时目录），账号 G13 模拟完整 1v1 5:0 主宰成就流程。

const ACCOUNT = "G13";
const sentToHuman: ArrayBuffer[] = [];

// 清空数据目录，避免成就残留导致幂等跳过通知验证。
const runDir = prepareEmptySmokeTestDataDir("duelDominationG13SmokeTest");

function join(
    game: Game,
    token: string,
    name: string,
    serverBot: boolean,
    account = "",
): Player {
    game.addJoinToken(token, false, 1, 60_000, false, serverBot);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = name;
    msg.loadoutPriv = account;
    const player = game.playerBarn.addPlayer(`${token}-socket`, msg);
    if (!player) throw new Error(`failed to join ${name}`);
    return player;
}

void (async () => {
    // 账号 G13 预建仓库。
    stashManager.getStash(ACCOUNT);
    stashManager.addCoins(ACCOUNT, 500);
    console.log(`初始: ${ACCOUNT} coins=${stashManager.getCoins(ACCOUNT)} achievements=[]`);

    let humanSocketId = "";
    const game = new Game(
        `duel-dom-${Date.now()}`,
        {
            mapName: "duel",
            teamMode: TeamMode.Solo,
            duelWeapons: ["m4a1", "mk12"],
            duelAiEnabled: true,
            duelAiDifficulty: "legit",
            duelDefaultLoadout: true,
        },
        (socketId, data) => {
            if (socketId === humanSocketId) sentToHuman.push(data);
        },
        () => {},
    );
    try {
        await game.init();
        const human = join(game, "human", "Human", false, ACCOUNT);
        humanSocketId = human.socketId;
        const bot = join(game, "bot", "AI-legit", true);
        assert.equal(human.stashName, ACCOUNT, "stashName = 账号名");
        assert.equal(human.accountAuthenticated, true, "登录玩家");

        // 5 轮：人类击杀 AI → 5:0。
        for (let round = 1; round <= 5; round++) {
            bot.damage({
                amount: 99999,
                damageType: GameConfig.DamageType.Player,
                dir: { x: 1, y: 0 },
                source: human,
                gameSourceType: human.activeWeapon,
            });
            if (round < 5) {
                assert(game.arenaMatch);
                game.arenaMatch.resetTicker = 0;
                game.update();
            }
        }

        assert.equal(game.over, true, "比赛结束");
        assert.equal(game.arenaMatch?.scores.get(human.__id), 5, "人类 5 分");
        assert.equal(game.arenaMatch?.scores.get(bot.__id), 0, "AI 0 分");

        // 真实写入验证。
        assert.equal(
            stashManager.hasAchievement(ACCOUNT, AchievementIds.DuelDomination),
            true,
            "G13 主宰成就已写入仓库",
        );
        const view = stashManager.publicStashView(ACCOUNT);
        assert.ok(view, "仓库视图存在");
        assert.deepEqual(
            view!.achievements,
            [AchievementIds.DuelDomination],
            "publicStashView 返回成就",
        );
        const lb = stashManager.leaderboard(50);
        const g13 = lb.find((p) => p.name === ACCOUNT);
        assert.ok(g13, "G13 在排行榜");
        assert.deepEqual(
            g13!.achievements,
            [AchievementIds.DuelDomination],
            "排行榜徽章包含主宰",
        );
        console.log(`排行榜 ${ACCOUNT}: coins=${g13!.coins} achievements=${g13!.achievements.join(",")}`);

        // 客户端通知。
        for (let i = 0; i < 3; i++) game.update();
        const unlocked = sentToHuman.some((buffer) => {
            const stream = new net.MsgStream(buffer);
            if (stream.deserializeMsgType() !== net.MsgType.AchievementUnlocked) {
                return false;
            }
            const msg = new net.AchievementUnlockedMsg();
            msg.deserialize(stream.stream);
            return msg.achievementId === AchievementIds.DuelDomination;
        });
        console.log(`sentToHuman buffers: ${sentToHuman.length}`);
        assert.equal(unlocked, true, "客户端收到成就解锁通知");

        // 幂等。
        const again = stashManager.grantAchievement(
            ACCOUNT,
            AchievementIds.DuelDomination,
        );
        assert.equal(again.awarded, false, "重复授予幂等");

        console.log("\n✅ G13 主宰成就真实发放实测通过：");
        console.log(`   - 1v1 默认配装 LEGIT AI 5:0`);
        console.log(`   - grantAchievement(${ACCOUNT}) → awarded=true`);
        console.log(`   - 仓库持久化: achievements=[${AchievementIds.DuelDomination}]`);
        console.log(`   - 排行榜徽章可见`);
        console.log(`   - 客户端 AchievementUnlocked 通知已发送`);
        console.log(`   - 幂等（重复不重复写入）`);
        const stashFile = path.join(runDir, "survivio-stash.json");
        console.log(`   - stash 文件: ${stashFile} (${fs.statSync(stashFile).size} bytes)`);
    } finally {
        game.stop();
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
