import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import {
    itemValue,
    levelFromScore,
    stashScore,
    StashManager,
} from "./stash/stashManager.ts";

/**
 * 排行榜 / 查看他人仓库（只读）冒烟测试：
 * - itemValue / stashScore / levelFromScore 估值逻辑；
 * - leaderboard 按身价降序；
 * - publicStashView 只读快照（不存在的玩家返回 null，不创建仓库）。
 * 使用独立临时仓库文件，不触碰 server-data 里的真实玩家数据。
 */
const tmpName = `lb-test-${process.pid}-${Date.now()}.json`;
const tmpPath = path.join(process.cwd(), "server-data", tmpName);

try {
    const sm = new StashManager(tmpName);
    sm.addItem("alpha", "ak47", 2);
    sm.addItem("alpha", "awm", 1);
    sm.addItem("alpha", "bandage", 10);
    sm.addItem("beta", "m249", 1);
    sm.addItem("beta", "8xscope", 1);
    sm.setCoins("beta", 500);

    const lb = sm.leaderboard(10);
    assert.ok(lb.length >= 2, "both players ranked");
    assert.ok(lb[0].score >= lb[1].score, "sorted by score desc");
    assert.ok(lb[0].level >= 1 && lb[0].level <= 99, "level in range");

    const view = sm.publicStashView("alpha");
    assert.ok(view, "view exists");
    assert.ok(view.score > 0, "score positive");
    assert.ok(
        view.items.guns && Number(view.items.guns.ak47 ?? 0) >= 2,
        "items snapshot keeps added guns",
    );
    assert.equal(sm.publicStashView("__nobody__"), null, "missing returns null");

    assert.ok(itemValue("awm") > 0, "unknown gun falls back to a value");
    assert.ok(itemValue("ak47") > 0 && itemValue("bandage") > 0);
    // 等级曲线：每 15000 身价升 1 级，最富裕玩家（约 6.5 万）为 LV5。
    assert.equal(levelFromScore(5000), 1, "low score stays level 1");
    assert.equal(levelFromScore(65515), 5, "richest player ~ LV5");
    assert.equal(levelFromScore(800000), 50, "capped at level 50");
    assert.ok(stashScore(sm.getStash("alpha")) > 0, "stashScore positive");

    console.log(
        "Leaderboard smoke test passed: itemValue/stashScore/level, sorted leaderboard, read-only publicStashView.",
    );
} catch (error) {
    console.error(error);
    process.exit(1);
} finally {
    try {
        fs.rmSync(tmpPath, { force: true });
    } catch {
        // ignore
    }
    try {
        fs.rmSync(`${tmpPath}.lock`, { force: true });
    } catch {
        // ignore
    }
}
