import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GameConfig } from "../../shared/gameConfig.ts";
import { getBagCapacity } from "../../shared/utils/bagCapacity.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const smartBotSource = fs.readFileSync(path.join(__dirname, "smartBot.ts"), "utf8") + "\n" + fs.readFileSync(path.join(__dirname, "bot", "smartBotSupport.ts"), "utf8");

// 1. scoreLoot must never target heal items the backpack cannot hold.
assert.match(
    smartBotSource,
    /case "heal": \{[\s\S]{0,400}const capacity = this\.inventoryCapacity\(type\);[\s\S]{0,260}if \(current >= capacity\) return -100;[\s\S]{0,180}Math\.min\(type === "bandage" \? 10 : 3, capacity\)/,
    "heal loot must be capped by the current backpack capacity",
);
// 2. Same for boost items.
assert.match(
    smartBotSource,
    /case "boost": \{[\s\S]{0,400}const capacity = this\.inventoryCapacity\(type\);[\s\S]{0,260}if \(current >= capacity\) return -100;[\s\S]{0,180}Math\.min\(type === "soda" \? 5 : 2, capacity\)/,
    "boost loot must be capped by the current backpack capacity",
);
// 3. Same for throwables.
assert.match(
    smartBotSource,
    /case "throwable": \{[\s\S]{0,320}if \(current >= this\.inventoryCapacity\(type\)\) return -100;/,
    "throwable loot must be skipped when the backpack is full",
);
// 4. A server Pickup Full response must blacklist the object.
assert.match(
    smartBotSource,
    /private handlePickupResult\(msg: net\.PickupMsg\): void \{[\s\S]{0,120}if \(msg\.type !== net\.PickupMsgType\.Full/,
    "Pickup Full must be handled explicitly",
);
assert.match(
    smartBotSource,
    /ignoredLootUntil\.set\(this\.currentLootId, now\(\) \+ 8000\)/,
    "a full-backpack loot object must be blacklisted for several seconds",
);

// 5. Prove the underlying mismatch existed: with a level-0 backpack the bot
//    old heal/boost targets exceeded the bag capacities, which is why the
//    server answered Pickup Full and the bot looped.
assert.equal(GameConfig.bagSizes.bandage[0], 5, "bandage capacity at backpack 0");
assert.ok(GameConfig.bagSizes.bandage[0] < 10, "old bandage target (10) exceeded capacity");
assert.equal(GameConfig.bagSizes.healthkit[0], 1, "medkit capacity at backpack 0");
assert.ok(GameConfig.bagSizes.healthkit[0] < 3, "old medkit target (3) exceeded capacity");
assert.equal(GameConfig.bagSizes.soda[0], 2, "soda capacity at backpack 0");
assert.ok(GameConfig.bagSizes.soda[0] < 5, "old soda target (5) exceeded capacity");
assert.equal(GameConfig.bagSizes.painkiller[0], 1, "painkiller capacity at backpack 0");
assert.ok(GameConfig.bagSizes.painkiller[0] < 2, "old painkiller target (2) exceeded capacity");
assert.equal(GameConfig.bagSizes.frag[0], 3, "frag capacity at backpack 0");
assert.ok(GameConfig.bagSizes.frag[0] < 4, "old frag threshold (4) exceeded capacity");

// 6. 搜打撤模式：仅三级包弹药携带量翻倍（×2），无包/1/2 级包与其他物品/模式不变。
assert.equal(getBagCapacity("762mm", 1, false), 180, "base 762mm cap at backpack 1");
assert.equal(getBagCapacity("762mm", 1, true), 180, "extraction level-1 backpack is NOT doubled");
assert.equal(getBagCapacity("9mm", 0, false), 120, "base 9mm cap at backpack 0");
assert.equal(getBagCapacity("9mm", 0, true), 120, "extraction no-backpack is NOT doubled");
assert.equal(getBagCapacity("9mm", 2, true), 330, "extraction level-2 backpack is NOT doubled");
assert.equal(getBagCapacity("9mm", 3, false), 420, "base 9mm cap at backpack 3");
assert.equal(getBagCapacity("9mm", 3, true), 840, "extraction level-3 backpack ammo is doubled");
assert.equal(getBagCapacity("762mm", 3, true), 600, "extraction level-3 backpack ammo is doubled");
assert.equal(getBagCapacity("bandage", 3, true), 30, "meds are not doubled");
assert.equal(getBagCapacity("frag", 3, true), 12, "throwables are not doubled");
// 服务器发放/局内拾取必须走同一个翻倍函数，客户端展示与之保持一致。
const stashSource = fs.readFileSync(path.join(__dirname, "stash", "stashManager.ts"), "utf8");
assert.match(
    stashSource,
    /getBagCapacity\(type, backpackLevel, true\)/,
    "stash loadout/grant must use the doubled extraction capacity",
);
const inventorySource = fs.readFileSync(
    path.join(__dirname, "game", "inventoryManager.ts"),
    "utf8",
);
assert.match(
    inventorySource,
    /getBagCapacity\(\s*item,\s*bagLevel,\s*extractionMode/,
    "in-match pickup/drop capacity must use the doubled extraction capacity",
);

assert.equal(GameConfig.bagSizes.bandage[0], 5);
console.log("Loot capacity smoke test passed: heal/boost/throwable targets are capped by the backpack and Pickup Full blacklists the object.");
