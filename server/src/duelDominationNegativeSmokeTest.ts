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

// 用法：SURVIV_DATA_DIR=<临时目录> npx tsx duelDominationNegativeSmokeTest.ts
// 实测三个场景：
//   1. 非默认配装 (duelDefaultLoadout=false) + LEGIT 5:0 → 不发放
//   2. 默认配装 + 非 LEGIT/HACKER 难度 (pro) 5:0 → 不发放
//   3. 对照组：默认配装 + LEGIT 5:0 → 发放（确保测试有效）

const ACCOUNT = "G13";
const runDir = prepareEmptySmokeTestDataDir("duelDominationNegativeSmokeTest");

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

/** 每场景前清空数据目录重建 G13 仓库（隔离成就状态）。 */
function resetStash(): void {
    const stashFile = path.join(runDir, "survivio-stash.json");
    if (fs.existsSync(stashFile)) fs.rmSync(stashFile, { force: true });
    stashManager.getStash(ACCOUNT);
    stashManager.addCoins(ACCOUNT, 500);
}

async function runScenario(
    label: string,
    config: {
        duelWeapons: [string, string];
        duelAiDifficulty: "pro" | "legit" | "forbidden";
        duelDefaultLoadout: boolean;
    },
): Promise<{ granted: boolean; notified: boolean; score: number }> {
    const sent: ArrayBuffer[] = [];
    let humanSocketId = "";
    const game = new Game(
        `duel-neg-${Date.now()}-${Math.random().toString(36).slice(3)}`,
        {
            mapName: "duel",
            teamMode: TeamMode.Solo,
            duelWeapons: config.duelWeapons,
            duelAiEnabled: true,
            duelAiDifficulty: config.duelAiDifficulty,
            duelDefaultLoadout: config.duelDefaultLoadout,
        },
        (socketId, data) => {
            if (socketId === humanSocketId) sent.push(data);
        },
        () => {},
    );
    try {
        await game.init();
        const human = join(game, "human", "Human", false, ACCOUNT);
        humanSocketId = human.socketId;
        const bot = join(game, "bot", "AI", true);

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
        for (let i = 0; i < 3; i++) game.update();

        assert.equal(game.over, true, `${label}: 比赛结束`);
        assert.equal(game.arenaMatch?.scores.get(human.__id), 5, `${label}: 人类 5 分`);
        const granted = stashManager.hasAchievement(
            ACCOUNT,
            AchievementIds.DuelDomination,
        );
        const notified = sent.some((buffer) => {
            const stream = new net.MsgStream(buffer);
            if (stream.deserializeMsgType() !== net.MsgType.AchievementUnlocked) {
                return false;
            }
            const msg = new net.AchievementUnlockedMsg();
            msg.deserialize(stream.stream);
            return msg.achievementId === AchievementIds.DuelDomination;
        });
        console.log(
            `  [${label}] 难度=${config.duelAiDifficulty} 默认配装=${config.duelDefaultLoadout} → 授予=${granted} 通知=${notified}`,
        );
        return { granted, notified, score: game.arenaMatch!.scores.get(human.__id)! };
    } finally {
        game.stop();
    }
}

void (async () => {
    stashManager.getStash(ACCOUNT);
    stashManager.addCoins(ACCOUNT, 500);

    // 场景 1：非默认配装 + LEGIT。
    resetStash();
    const custom = await runScenario("自定义配装", {
        duelWeapons: ["ak47", "mp5"],
        duelAiDifficulty: "legit",
        duelDefaultLoadout: false,
    });
    assert.equal(custom.granted, false, "非默认配装不授予");
    assert.equal(custom.notified, false, "非默认配装无通知");

    // 场景 2：默认配装 + 非 LEGIT/HACKER 难度（pro）。
    resetStash();
    const pro = await runScenario("非LEGIT难度", {
        duelWeapons: ["m4a1", "mk12"],
        duelAiDifficulty: "pro",
        duelDefaultLoadout: true,
    });
    assert.equal(pro.granted, false, "非 LEGIT/HACKER 难度不授予");
    assert.equal(pro.notified, false, "非 LEGIT/HACKER 难度无通知");

    // 场景 3：对照组（默认配装 + LEGIT）→ 应发放。
    resetStash();
    const legit = await runScenario("对照组LEGIT", {
        duelWeapons: ["m4a1", "mk12"],
        duelAiDifficulty: "legit",
        duelDefaultLoadout: true,
    });
    assert.equal(legit.granted, true, "对照组 LEGIT 应授予");
    assert.equal(legit.notified, true, "对照组 LEGIT 有通知");

    // HACKER（forbidden）对照组 → 也应发放。
    resetStash();
    const hacker = await runScenario("对照组HACKER", {
        duelWeapons: ["m4a1", "mk12"],
        duelAiDifficulty: "forbidden",
        duelDefaultLoadout: true,
    });
    assert.equal(hacker.granted, true, "HACKER 也应授予");

    const stashFile = path.join(runDir, "survivio-stash.json");
    console.log(`\nstash 文件: ${stashFile}`);
    console.log("\n✅ 主宰成就负向实测通过：");
    console.log("   - 非默认配装 5:0 LEGIT → 不发放（仓库无成就、无通知）");
    console.log("   - 默认配装 5:0 非 LEGIT/HACKER(pro) → 不发放");
    console.log("   - 对照组 默认配装 5:0 LEGIT / HACKER → 正常发放");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
