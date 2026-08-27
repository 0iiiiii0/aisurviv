import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getServerDataFilePath } from "./config.ts";
import { StashManager } from "./stash/stashManager.ts";

const TEST_FILE = "survivio-test-stash-lock.json";

async function main(): Promise<void> {
    const file = getServerDataFilePath(TEST_FILE);
    const lockPath = `${file}.lock`;
    try {
        fs.rmSync(file, { force: true });
    } catch {
        // ignore
    }
    try {
        fs.rmSync(lockPath, { recursive: true, force: true });
    } catch {
        // ignore
    }

    const stash = new StashManager(TEST_FILE);
    try {
        assert.equal(stash.addItem("LockTester", "ak47", 1).ok, true);

        // 1) 残留锁（拥有者 PID 已死，如进程崩溃/被杀后遗留）→ 立即接管，
        //    不再“重试满 2s 后抛异常炸服”。这是旧版反复炸服的根因之一。
        fs.mkdirSync(lockPath, { recursive: true });
        fs.writeFileSync(path.join(lockPath, "owner"), "999999999 0", "utf8");
        const players = stash.listAll();
        assert.equal(players.length, 1, "dead-owner stale lock must be reclaimed");
        assert.equal(
            fs.existsSync(lockPath),
            false,
            "lock must be released after the read",
        );

        // 2) 正常读写不受影响。
        const ammoBefore =
            Number(stash.getStash("LockTester").items.ammo["762mm"] ?? 0);
        stash.addItem("LockTester", "762mm", 30);
        const ammoAfter =
            Number(stash.getStash("LockTester").items.ammo["762mm"] ?? 0);
        assert.equal(ammoAfter - ammoBefore, 30, "ammo stacks normally");

        // 3) 写入失败时锁也会被释放（withLockSync finally），不会残留。
        const bad = stash.addItem("LockTester", "bogus_item", 1);
        assert.equal(bad.ok, false, "invalid items rejected");
        assert.equal(fs.existsSync(lockPath), false, "lock released after error");
    } finally {
        try {
            fs.rmSync(file, { force: true });
        } catch {
            // ignore
        }
        try {
            fs.rmSync(lockPath, { recursive: true, force: true });
        } catch {
            // ignore
        }
    }

    console.log(
        "Stash lock recovery smoke test passed: dead-owner stale lock reclaimed immediately.",
    );
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});
