import assert from "node:assert/strict";
import { evaluateDualSwitch } from "./bot/dualSwitch.ts";

const base = {
    difficulty: "pro",
    currentCooldown: 1.6, // 狙击射击后冷却（慢）
    otherCooldown: 0,
    otherAmmo: 30,
    otherInRange: true,
    currentMaxClip: 5,
    otherMaxClip: 30,
    currentBulletCount: 1,
    otherBulletCount: 1,
    currentRange: 120,
    otherRange: 40,
    targetDistance: 60,
    currentDeployGroup: 0,
    otherDeployGroup: 0,
    switchDelay: 0.3,
    shotConfirmed: true,
};

// 1) 狙击（慢单发）+ 自动副武器（经典双切）→ 允许
const sniperAuto = evaluateDualSwitch({
    ...base,
    currentType: "awm",
    otherType: "m4a1",
    currentFireMode: "single",
    otherFireMode: "auto",
    currentFireDelay: 1.8,
    otherFireDelay: 0.08,
});
console.log(`狙击+自动 → useful=${sniperAuto.useful} reason=${sniperAuto.reason}`);
assert.equal(sniperAuto.useful, true, "狙击+自动副武器应支持双切");

// 2) DMR（快单发）+ 自动 → 拒绝（防乱切）
const dmrAuto = evaluateDualSwitch({
    ...base,
    currentType: "m39",
    otherType: "m4a1",
    currentFireMode: "single",
    otherFireMode: "auto",
    currentFireDelay: 0.3,
    otherFireDelay: 0.08,
});
console.log(`DMR+自动 → useful=${dmrAuto.useful} reason=${dmrAuto.reason}`);
assert.equal(dmrAuto.useful, false, "快单发 DMR + 自动不双切");

// 3) 狙击 + 单发副武器（原行为保持）→ 允许
const sniperSingle = evaluateDualSwitch({
    ...base,
    currentType: "awm",
    otherType: "m39",
    currentFireMode: "single",
    otherFireMode: "single",
    currentFireDelay: 1.8,
    otherFireDelay: 0.3,
});
console.log(`狙击+单发 → useful=${sniperSingle.useful} reason=${sniperSingle.reason}`);
assert.equal(sniperSingle.useful, true, "双单发双切保持");

console.log("\nDual-switch test passed: pro sniper now cycles to auto secondary; DMR+auto rejected; single+single preserved.");
