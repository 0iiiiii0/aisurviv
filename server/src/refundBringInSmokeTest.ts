import assert from "node:assert/strict";
import fs from "fs";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Config, getServerDataFilePath } from "./config.ts";
import { StashManager } from "./stash/stashManager.ts";

const prevSecret = JSON.parse(JSON.stringify(Config.extractionSecret)) as typeof Config.extractionSecret;
Config.extractionSecret.enabled = true;

const TEST_FILE = "survivio-test-refund-bring-in.json";
const testPath = getServerDataFilePath(TEST_FILE);
fs.rmSync(testPath, { force: true });
fs.rmSync(`${testPath}.lock`, { recursive: true, force: true });
const getJson = () => JSON.parse(fs.readFileSync(testPath, "utf8"));

void (async () => {
    try {
        const stash = new StashManager(TEST_FILE);

        // 1) 配装带入 firepower（永久技能）+ m4a1 + 一次性技能 steelskin。
        stash.addItem("Refunder", "m4a1", 1);
        stash.addItem("Refunder", "firepower", 1);
        stash.addCoins("Refunder", 6000);
        assert.ok(stash.buyOneTimePerk("Refunder", "steelskin", 3000).ok);
        stash.setLoadout("Refunder", {
            guns: ["m4a1", ""],
            ammo: { "556mm": 30 },
            consumables: {},
            armor: {},
            perks: ["firepower"],
            oneTimePerks: ["steelskin"],
        });
        const before = getJson();
        const granted = stash.grantLoadout("Refunder");
        assert.ok(granted, "grantLoadout 发起成功");
        assert.deepEqual(granted.perks, ["firepower"], "携带技能已发放");
        assert.deepEqual(granted.oneTimePerks, ["steelskin"], "一次性能力已消耗");

        // 入仓：扣除后仓库中对应的库存应为空或减少。
        const afterGrant = stash.getStash("Refunder");
        assert.equal(afterGrant.items.guns.m4a1, undefined, "m4a1 已扣");
        assert.equal(afterGrant.items.perks.firepower, undefined, "永久技能 firepower 已扣");
        assert.equal(afterGrant.oneTimePerks, undefined, "一次性能力已消耗");
        assert.ok(getJson().pendingGrants?.["Refunder"], "pendingGrants 已记录");
        console.log("✓ grantLoadout 扣除装备正确 + pendingGrants 已记录");

        // 3) 归还：recoverPendingGrant → 装备回到仓库 + pending 清除。
        const refunded = stash.recoverPendingGrant("Refunder");
        assert.ok(refunded, "recoverPendingGrant 成功");

        const afterRefund = stash.getStash("Refunder");
        assert.equal(afterRefund.items.guns.m4a1, 1, "m4a1 已归还");
        assert.equal(afterRefund.items.perks.firepower, 1, "永久技能 firepower 已归还");
        assert.deepEqual(afterRefund.oneTimePerks, ["steelskin"], "一次性能力已归还");
        assert.equal(getJson().pendingGrants?.["Refunder"], undefined, "pendingGrants 已清除");
        console.log("✓ 归还后装备回仓库 + pending 清除");

        // 4) 二次归还必须返回 false（无 pending）。
        assert.equal(stash.recoverPendingGrant("Refunder"), false, "无待结算不能再归还");
        console.log("✓ 无待结算时拒绝归还");

        // 5) 重新配装进局 → 正常结算（clearPendingGrant）→ 不归还。
        stash.addItem("Refunder", "m4a1", 1);
        stash.setLoadout("Refunder", {
            guns: ["m4a1", ""],
            ammo: {},
            consumables: {},
            armor: {},
        });
        assert.ok(stash.grantLoadout("Refunder"), "第二次 grantLoadout");
        stash.clearPendingGrant("Refunder");
        assert.equal(getJson().pendingGrants?.["Refunder"], undefined, "clearPendingGrant 清除 pending");
        console.log("✓ clearPendingGrant 正常结算");

        // 6) 混合配装归还：枪 + 能力 + 一次性。
        stash.addItem("Refunder", "scar", 1);
        stash.addItem("Refunder", "steelskin", 1);
        stash.buyOneTimePerk("Refunder", "windwalk", 0);
        stash.setLoadout("Refunder", {
            guns: ["scar", ""],
            ammo: {},
            consumables: {},
            armor: {},
            perks: ["steelskin"],
            oneTimePerks: ["windwalk"],
        });
        const g = stash.grantLoadout("Refunder");
        assert.ok(g, "混合配装 grant");
        assert.equal(stash.getStash("Refunder").items.guns.scar, undefined, "scar 已扣");

        assert.equal(stash.recoverPendingGrant("Refunder"), true, "混合配装归还");
        assert.equal(stash.getStash("Refunder").items.guns.scar, 1, "scar 已归还");
        console.log("✓ 混合配装（枪+能力+一次性）全部归还");

        console.log("\nRefund brought-in loadout test passed.");
    } finally {
        Config.extractionSecret = prevSecret;
        try { fs.rmSync(testPath, { force: true }); } catch {}
        try { fs.rmSync(`${testPath}.lock`, { force: true }); } catch {}
    }
})();
