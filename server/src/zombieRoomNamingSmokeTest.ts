import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
    formatZombieRoomDisplayName,
    normalizeZombieDifficulty,
    ZOMBIE_DIFFICULTY_LABELS,
} from "../../shared/defs/zombieDefs.ts";

assert.equal(ZOMBIE_DIFFICULTY_LABELS.simple, "简单");
assert.equal(ZOMBIE_DIFFICULTY_LABELS.normal, "普通");
assert.equal(ZOMBIE_DIFFICULTY_LABELS.hard, "困难");
assert.equal(normalizeZombieDifficulty(undefined), "normal");
assert.equal(normalizeZombieDifficulty("bad"), "normal");
assert.equal(
    formatZombieRoomDisplayName("僵尸模式 四人", "simple"),
    "【简单】僵尸模式 四人",
);
assert.equal(
    formatZombieRoomDisplayName("僵尸模式 双人", "normal"),
    "【普通】僵尸模式 双人",
);
assert.equal(
    formatZombieRoomDisplayName("僵尸模式 单人", "hard"),
    "【困难】僵尸模式 单人",
);

for (const path of ["client/public/admin/admin.js", "client/dist/admin/admin.js"]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /zombieDifficultyNames/);
    assert.match(source, /【\$\{zombieDifficultyNames\[game\.zombieDifficulty\]/);
}

const gameServerSource = readFileSync("server/src/gameServer.ts", "utf8");
assert.match(gameServerSource, /formatZombieRoomDisplayName/);
assert.match(gameServerSource, /game\.zombieDifficulty/);

const adminServerSource = readFileSync("server/src/adminServer.ts", "utf8");
assert.match(adminServerSource, /zombieDifficulty: game\.zombieDifficulty/);

console.log("Zombie room naming smoke test passed: difficulty prefixes are consistent in spectator/admin room lists.");
