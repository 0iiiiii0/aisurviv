import assert from "node:assert/strict";
import { AchievementIds } from "../../shared/defs/achievementDefs.ts";
import { StashManager } from "./stash/stashManager.ts";

// 用法：SURVIV_DATA_DIR=D:\codex项目\surviv.io\log\surviv-data npx tsx grantNuclearAchievement.ts 9986 gujian

const accounts = process.argv.slice(2);
if (accounts.length === 0) {
    console.error("用法: grantNuclearAchievement.ts <账号...>");
    process.exit(1);
}

const stash = new StashManager("survivio-stash.json");

for (const account of accounts) {
    const before = stash.hasAchievement(account, AchievementIds.ZombieNuclearHard);
    console.log(`[${account}] 发放前 hasNuclear=${before}`);
    const result = stash.grantAchievement(account, AchievementIds.ZombieNuclearHard);
    console.log(
        `[${account}] grantAchievement → ok=${result.ok} awarded=${result.awarded} achievements=${
            result.achievements.join(",")
        }`,
    );
    const after = stash.hasAchievement(account, AchievementIds.ZombieNuclearHard);
    assert.equal(after, true, `${account} 发放成功`);
    const view = stash.publicStashView(account);
    if (view) {
        console.log(
            `[${account}] 验证: publicStashView coins=${view.coins} achievements=${view.achievements.join(",")}`,
        );
    }
    // 幂等：再次发放不重复。
    const again = stash.grantAchievement(account, AchievementIds.ZombieNuclearHard);
    console.log(`[${account}] 重复发放 awarded=${again.awarded}（应为 false）`);
    assert.equal(again.awarded, false, `${account} 幂等`);
}

// 排行榜确认。
const lb = stash.leaderboard(200);
for (const account of accounts) {
    const entry = lb.find((p) => p.name === account);
    if (entry) {
        console.log(
            `[排行榜] ${account}: coins=${entry.coins} level=${entry.level} achievements=${
                entry.achievements.join(",")
            }`,
        );
    } else {
        console.log(`[排行榜] ${account}: 不在榜内`);
    }
}

console.log("\n✅ 核爆成就发放完成。");
