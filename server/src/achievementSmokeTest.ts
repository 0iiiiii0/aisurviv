import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
    AchievementIds,
    normalizeAchievementIds,
} from "../../shared/defs/achievementDefs.ts";
import { qualifiesForDuelDomination } from "./game/game.ts";
import { StashManager } from "./stash/stashManager.ts";

const tempName = `achievement-test-${process.pid}-${Date.now()}.json`;
const tempPath = path.join(process.cwd(), "server-data", tempName);

try {
    assert.deepEqual(
        normalizeAchievementIds([
            AchievementIds.DuelDomination,
            AchievementIds.DuelDomination,
            "toString",
            "unknown_achievement",
        ]),
        [AchievementIds.DuelDomination],
        "only unique, explicitly defined achievement ids are accepted",
    );

    const stash = new StashManager(tempName);
    stash.getStash("Champion");
    const first = stash.grantAchievement(
        "Champion",
        AchievementIds.DuelDomination,
    );
    const second = stash.grantAchievement(
        "Champion",
        AchievementIds.DuelDomination,
    );
    assert.equal(first.awarded, true, "first grant unlocks the achievement");
    assert.equal(second.awarded, false, "duplicate grants are idempotent");
    assert.equal(
        stash.hasAchievement("Champion", AchievementIds.DuelDomination),
        true,
        "achievement survives a disk reload",
    );
    assert.deepEqual(stash.leaderboard(10)[0].achievements, [
        AchievementIds.DuelDomination,
    ]);
    assert.deepEqual(stash.publicStashView("Champion")?.achievements, [
        AchievementIds.DuelDomination,
    ]);

    const qualifying = {
        mapName: "duel",
        aiEnabled: true,
        aiDifficulty: "legit",
        defaultLoadout: true,
        winnerIsBot: false,
        winnerAuthenticated: true,
        winnerScore: 5,
        loserScore: 0,
    };
    assert.equal(qualifiesForDuelDomination(qualifying), true);
    assert.equal(
        qualifiesForDuelDomination({ ...qualifying, aiDifficulty: "forbidden" }),
        true,
        "HACKER also qualifies",
    );
    assert.equal(
        qualifiesForDuelDomination({ ...qualifying, winnerScore: 4 }),
        false,
        "not 5:0",
    );
    assert.equal(
        qualifiesForDuelDomination({ ...qualifying, loserScore: 1 }),
        false,
        "5:1 does not qualify",
    );
    assert.equal(
        qualifiesForDuelDomination({ ...qualifying, defaultLoadout: false }),
        false,
        "custom loadout does not qualify",
    );
    assert.equal(
        qualifiesForDuelDomination({ ...qualifying, winnerAuthenticated: false }),
        false,
        "anonymous players cannot receive persistent achievements",
    );
    assert.equal(
        qualifiesForDuelDomination({ ...qualifying, aiDifficulty: "pro" }),
        false,
        "lower AI difficulty does not qualify",
    );

    console.log(
        "Achievement smoke test passed: persistent idempotent grants, leaderboard badges, strict LEGIT/HACKER 5:0 qualification.",
    );
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    fs.rmSync(tempPath, { force: true });
    fs.rmSync(`${tempPath}.lock`, { recursive: true, force: true });
}
