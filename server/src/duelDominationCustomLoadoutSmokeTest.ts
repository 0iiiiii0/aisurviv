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

// 用法：SURVIV_DATA_DIR=<临时目录> npx tsx duelDominationCustomLoadoutSmokeTest.ts
// 实测：非默认配装（duelDefaultLoadout: false）击杀 AI 5:0 → 不应发放主宰成就。

const ACCOUNT = "G13";
const sentToHuman: ArrayBuffer[] = [];

const runDir = prepareEmptySmokeTestDataDir("duelDominationCustomLoadoutSmokeTest");

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
    stashManager.getStash(ACCOUNT);
    stashManager.addCoins(ACCOUNT, 500);
    console.log(`初始: ${ACCOUNT} coins=${stashManager.getCoins(ACCOUNT)} achievements=[]`);

    let humanSocketId = "";
    // 非默认配装：duelDefaultLoadout=false，其余条件全满足（1v1 + LEGIT + 5:0 + 登录）。
    const game = new Game(
        `duel-custom-${Date.now()}`,
        {
            mapName: "duel",
            teamMode: TeamMode.Solo,
            duelWeapons: ["ak47", "mp5"],
            duelAiEnabled: true,
            duelAiDifficulty: "legit",
            duelDefaultLoadout: false,
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

        // 比赛本身正常结束 5:0。
        assert.equal(game.over, true, "比赛结束");
        assert.equal(game.arenaMatch?.scores.get(human.__id), 5, "人类 5 分");
        assert.equal(game.arenaMatch?.scores.get(bot.__id), 0, "AI 0 分");

        // 不应发放：仓库无成就。
        assert.equal(
            stashManager.hasAchievement(ACCOUNT, AchievementIds.DuelDomination),
            false,
            "非默认配装不授予主宰",
        );
        const view = stashManager.publicStashView(ACCOUNT);
        assert.ok(view, "仓库视图存在");
        assert.deepEqual(view!.achievements, [], "无成就写入");

        // 不应发放：无解锁通知。
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
        assert.equal(unlocked, false, "无客户端解锁通知");

        const stashFile = path.join(runDir, "survivio-stash.json");
        const raw = fs.readFileSync(stashFile, "utf8");
        assert.ok(
            !raw.includes("duel_domination"),
            "stash 文件无 duel_domination",
        );
        console.log(`stash 文件内容含 duel_domination: ${raw.includes("duel_domination")}`);

        console.log("\n✅ 非默认配装实测通过：");
        console.log(`   - 1v1 自定义配装 (duelDefaultLoadout=false) 5:0 LEGIT AI`);
        console.log(`   - 比赛正常结束 5:0`);
        console.log(`   - 主宰成就【未发放】——仓库无成就、无通知、无写入`);
        console.log(`   - 符合规则：只有默认配装 5:0 才发放`);
    } finally {
        game.stop();
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
