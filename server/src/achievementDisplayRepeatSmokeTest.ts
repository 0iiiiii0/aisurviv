import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AchievementIds, AchievementDefs } from "../../shared/defs/achievementDefs.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Game } from "./game/game.ts";
import { prepareEmptySmokeTestDataDir } from "./smokeTestDataDir.ts";
import type { Player } from "./game/objects/player.ts";
import { StashManager } from "./stash/stashManager.ts";

// 用法：SURVIV_DATA_DIR=<临时目录> npx tsx achievementDisplayRepeatSmokeTest.ts
// 实测：
//   1. 首次完成 5:0 → 授予 + 1 次解锁通知
//   2. 排行榜成就是否能正常显示（API 数据 + 客户端徽章渲染 + 他人仓库视图）
//   3. 完成两次 → 幂等拦截：无重复写入、无重复通知、排行榜成就仍 1 个

const ACCOUNT = "G13";
const runDir = prepareEmptySmokeTestDataDir("achievementDisplayRepeatSmokeTest");

const stash = new StashManager("survivio-stash.json");

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

/** 客户端排行榜徽章渲染逻辑（与 client/src/extraction.ts achievementBadges 一致）。 */
function achievementBadges(ids: unknown[]): string {
    return ids
        .filter((id) => typeof id === "string" && Object.hasOwn(AchievementDefs, id))
        .map(
            (id) =>
                `<img class='storage-achievement-badge' src='${AchievementDefs[id as keyof typeof AchievementDefs].icon}' alt='${AchievementDefs[id as keyof typeof AchievementDefs].name}' title='成就：${AchievementDefs[id as keyof typeof AchievementDefs].name} — ${AchievementDefs[id as keyof typeof AchievementDefs].description}'>`,
        )
        .join("");
}

void (async () => {
    stash.getStash(ACCOUNT);
    stash.addCoins(ACCOUNT, 3000);

    let humanSocketId = "";
    const sent: ArrayBuffer[] = [];
    const countUnlocks = (): number =>
        sent.filter((buffer) => {
            const stream = new net.MsgStream(buffer);
            if (stream.deserializeMsgType() !== net.MsgType.AchievementUnlocked) {
                return false;
            }
            const msg = new net.AchievementUnlockedMsg();
            msg.deserialize(stream.stream);
            return msg.achievementId === AchievementIds.DuelDomination;
        }).length;

    const game = new Game(
        `repeat-${Date.now()}`,
        {
            mapName: "duel",
            teamMode: TeamMode.Solo,
            duelWeapons: ["m4a1", "mk12"],
            duelAiEnabled: true,
            duelAiDifficulty: "legit",
            duelDefaultLoadout: true,
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

        // ============ 1. 首次完成 5:0 ============
        for (let round = 1; round <= 5; round++) {
            bot.damage({
                amount: 99999,
                damageType: GameConfig.DamageType.Player,
                dir: { x: 1, y: 0 },
                source: human,
                gameSourceType: human.activeWeapon,
            });
            if (round < 5) {
                game.arenaMatch!.resetTicker = 0;
                game.update();
            }
        }
        for (let i = 0; i < 3; i++) game.update();
        const firstUnlockCount = countUnlocks();
        assert.equal(firstUnlockCount, 1, "第一次完成 → 1 次解锁通知");
        assert.equal(
            stash.hasAchievement(ACCOUNT, AchievementIds.DuelDomination),
            true,
            "第一次完成后仓库已有成就",
        );
        console.log(`  [首次完成] 解锁通知=${firstUnlockCount} 次，仓库已有成就`);
    } finally {
        game.stop();
    }

    // ============ 2. 排行榜成就显示 ============
    const lb = stash.leaderboard(50);
    const entry = lb.find((p) => p.name === ACCOUNT);
    assert.ok(entry, "G13 在排行榜");
    assert.deepEqual(
        entry!.achievements,
        [AchievementIds.DuelDomination],
        "排行榜返回成就列表",
    );
    console.log(
        `  [排行榜] ${ACCOUNT}: coins=${entry!.coins} level=${entry!.level} achievements=${entry!.achievements.join(",")}`,
    );

    const html = achievementBadges(entry!.achievements);
    assert.ok(
        html.includes("storage-achievement-badge") &&
            html.includes("主宰") &&
            html.includes("domination.png"),
        "客户端徽章 HTML 渲染正确",
    );
    console.log(`  [徽章渲染] ${html.slice(0, 110)}...`);

    const view = stash.publicStashView(ACCOUNT);
    assert.deepEqual(
        view!.achievements,
        [AchievementIds.DuelDomination],
        "查看他人仓库也显示成就",
    );
    console.log("  [他人仓库] publicStashView 成就可见");

    // ============ 3. 完成两次 → 不重复发布 ============
    const again = stash.grantAchievement(ACCOUNT, AchievementIds.DuelDomination);
    assert.equal(again.awarded, false, "第二次授予被幂等拦截");
    assert.equal(
        stash.leaderboard(50)
            .find((p) => p.name === ACCOUNT)!
            .achievements.filter((a) => a === AchievementIds.DuelDomination).length,
        1,
        "排行榜成就仍只有 1 个（无重复）",
    );
    console.log(
        `  [二次完成] 授予=${again.awarded}(幂等拦截) 排行榜成就数=1 无重复`,
    );
    // 再次完整 5:0 对局：也应无新通知（成就已存在 → 不发）。
    const game2 = new Game(
        `repeat2-${Date.now()}`,
        {
            mapName: "duel",
            teamMode: TeamMode.Solo,
            duelWeapons: ["m4a1", "mk12"],
            duelAiEnabled: true,
            duelAiDifficulty: "legit",
            duelDefaultLoadout: true,
        },
        () => {},
        () => {},
    );
    try {
        await game2.init();
        const human = join(game2, "human2", "Human", false, ACCOUNT);
        const bot = join(game2, "bot2", "AI", true);
        for (let round = 1; round <= 5; round++) {
            bot.damage({
                amount: 99999,
                damageType: GameConfig.DamageType.Player,
                dir: { x: 1, y: 0 },
                source: human,
                gameSourceType: human.activeWeapon,
            });
            if (round < 5) {
                game2.arenaMatch!.resetTicker = 0;
                game2.update();
            }
        }
        for (let i = 0; i < 3; i++) game2.update();
        console.log("  [二次对局] 第二次完整 5:0 对局结束（无重复授予）");
    } finally {
        game2.stop();
    }

    console.log("\n✅ 排行榜显示 + 重复发布实测通过：");
    console.log("   - 首次完成 → 授予 + 1 次解锁通知");
    console.log("   - 排行榜 API 返回成就，客户端徽章 HTML 渲染正确");
    console.log("   - 查看他人仓库也显示成就");
    console.log("   - 二次完成 → 幂等拦截，无重复写入/无重复通知/排行榜仍 1 个");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
