import assert from "node:assert/strict";
import fs from "node:fs";
import { perkCarryOutCap } from "../../shared/defs/extractionDefs.ts";
import { getServerDataFilePath } from "./config.ts";
import { StashManager } from "./stash/stashManager.ts";

const TEST_FILE = "survivio-test-one-time-perk-stash.json";

function removeTestData(): void {
    const file = getServerDataFilePath(TEST_FILE);
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}.lock`, { recursive: true, force: true });
}

function emptyLoadout(oneTimePerks: string[] = []) {
    return {
        guns: [],
        ammo: {},
        consumables: {},
        armor: {},
        perks: [],
        oneTimePerks,
    };
}

async function main(): Promise<void> {
    removeTestData();
    const stash = new StashManager(TEST_FILE);

    try {
        // 同类型一次性能力的每一份都是独立付费库存。启动时的幽灵配装清理
        // 不得去重；进局只消耗选中的一份，pending 与仓库库存都计入持有数。
        stash.addCoins("WindwalkBuyer", 6_000);
        assert.equal(
            stash.buyOneTimePerk("WindwalkBuyer", "windwalk", 3_000).ok,
            true,
        );
        assert.equal(
            stash.buyOneTimePerk("WindwalkBuyer", "windwalk", 3_000).ok,
            true,
        );
        assert.deepEqual(stash.getStash("WindwalkBuyer").oneTimePerks, [
            "windwalk",
            "windwalk",
        ]);
        const windwalkReloaded = new StashManager(TEST_FILE);
        assert.deepEqual(
            windwalkReloaded.getStash("WindwalkBuyer").oneTimePerks,
            ["windwalk", "windwalk"],
            "重启后两份疾风步仍都在一次性仓库",
        );
        assert.equal(stash.cleanupGhostPerks(), 0);
        assert.equal(stash.oneTimePerkStock("WindwalkBuyer", "windwalk"), 2);
        stash.setLoadout("WindwalkBuyer", emptyLoadout(["windwalk"]));
        const windwalkGrant = stash.grantLoadout("WindwalkBuyer");
        assert.deepEqual(windwalkGrant?.oneTimePerks, ["windwalk"]);
        assert.equal(stash.oneTimePerkStock("WindwalkBuyer", "windwalk"), 1);
        assert.equal(
            stash.oneTimePerkOwnedCount("WindwalkBuyer", "windwalk"),
            2,
        );
        stash.clearPendingGrant("WindwalkBuyer");
        assert.equal(
            stash.oneTimePerkOwnedCount("WindwalkBuyer", "windwalk"),
            1,
        );

        // 1) 购买只写入一次性仓库，不自动写入配装或普通能力库存。
        stash.addCoins("PerkBuyer", 6_000);
        assert.equal(
            stash.buyOneTimePerk("PerkBuyer", "firepower", 3_000).ok,
            true,
        );
        assert.equal(
            stash.buyOneTimePerk("PerkBuyer", "steelskin", 3_000).ok,
            true,
        );
        let snapshot = stash.getStash("PerkBuyer");
        assert.deepEqual(snapshot.oneTimePerks, ["firepower", "steelskin"]);
        assert.deepEqual(snapshot.loadout.oneTimePerks ?? [], []);
        assert.equal(snapshot.items.perks.firepower, undefined);
        assert.equal(snapshot.items.perks.steelskin, undefined);

        // 2) 仓库有库存但没有手动选中时，进局发放不应触发，库存不变。
        assert.equal(stash.grantLoadout("PerkBuyer"), null);
        assert.deepEqual(stash.getStash("PerkBuyer").oneTimePerks, [
            "firepower",
            "steelskin",
        ]);

        // 3) 手动选中时校验库存；同 type 的普通/一次性能力不能重复装配。
        assert.equal(stash.addItem("PerkBuyer", "treat_9mm", 1).ok, true);
        const saved = stash.setLoadout("PerkBuyer", {
            ...emptyLoadout(["treat_9mm", "firepower", "not_a_perk"]),
            perks: ["treat_9mm"],
        });
        assert.equal(saved.ok, true);
        assert.deepEqual(saved.loadout?.perks, ["treat_9mm"]);
        assert.deepEqual(saved.loadout?.oneTimePerks, ["firepower"]);

        // 服务端强制普通 + 一次性能力合计最多 4 个，不信任客户端。
        for (const perk of ["firepower", "steelskin", "windwalk", "leadership"]) {
            assert.equal(stash.buyOneTimePerk("LimitBuyer", perk, 0).ok, true);
        }
        for (const perk of ["treat_9mm", "treat_12g"]) {
            assert.equal(stash.addItem("LimitBuyer", perk, 1).ok, true);
        }
        const capped = stash.setLoadout("LimitBuyer", {
            ...emptyLoadout(["firepower", "steelskin", "windwalk", "leadership"]),
            perks: ["treat_9mm", "treat_12g"],
        });
        assert.equal(
            (capped.loadout?.perks?.length ?? 0) +
                (capped.loadout?.oneTimePerks?.length ?? 0),
            4,
        );

        // 4) 只消耗已选中的 firepower，未选中的 steelskin 保留在仓库。
        const granted = stash.grantLoadout("PerkBuyer");
        assert.ok(granted);
        assert.deepEqual(granted.perks, ["treat_9mm"]);
        assert.deepEqual(granted.oneTimePerks, ["firepower"]);
        assert.equal(granted.perkCarryOutCap, perkCarryOutCap(2));
        snapshot = stash.getStash("PerkBuyer");
        assert.deepEqual(snapshot.oneTimePerks, ["steelskin"]);
        assert.deepEqual(snapshot.loadout.oneTimePerks ?? [], []);
        assert.equal(snapshot.items.perks.firepower, undefined);
        assert.deepEqual(stash.ownedOneTimePerks("PerkBuyer").sort(), [
            "firepower",
            "steelskin",
        ]);
        stash.addCoins("PerkBuyer", 3_000);
        // 允许购买多个同类型：待结算期间也可再买一个 firepower（pending 保护
        // 只影响目录的已拥有展示，不阻止重复购买）。
        const duplicateWhilePending = stash.buyOneTimePerk(
            "PerkBuyer",
            "firepower",
            3_000,
        );
        assert.equal(duplicateWhilePending.ok, true, "待结算期间允许重复购买同类型");
        assert.equal(stash.getCoins("PerkBuyer"), 0, "重复购买扣 3000");
        // 库存：原剩 steelskin + 新买 firepower。
        snapshot = stash.getStash("PerkBuyer");
        assert.deepEqual([...(snapshot.oneTimePerks ?? [])].sort(), [
            "firepower",
            "steelskin",
        ]);

        // 5) 服务端在本局结算前崩溃：普通能力归还 items.perks，
        //    一次性能力只归还独立库存，绝不混入普通能力。
        const rebooted = new StashManager(TEST_FILE);
        assert.equal(rebooted.recoverPendingGrants(), 1);
        snapshot = rebooted.getStash("PerkBuyer");
        // 库存（firepower 新买 + steelskin）+ 归还 pending 的 firepower。
        assert.deepEqual([...(snapshot.oneTimePerks ?? [])].sort(), [
            "firepower",
            "firepower",
            "steelskin",
        ]);
        assert.equal(snapshot.items.perks.treat_9mm, 1);
        assert.equal(snapshot.items.perks.firepower, undefined);

        // 6) 正常结算会消耗已使用的一次性能力，未选库存仍保留。
        //    库存（firepower×2 + steelskin）消耗勾选的 1 个 firepower。
        rebooted.setLoadout("PerkBuyer", emptyLoadout(["firepower"]));
        const consumed = rebooted.grantLoadout("PerkBuyer");
        assert.deepEqual(consumed?.oneTimePerks, ["firepower"]);
        rebooted.clearPendingGrant("PerkBuyer");
        const afterSettlement = new StashManager(TEST_FILE);
        assert.equal(afterSettlement.recoverPendingGrants(), 0);
        snapshot = afterSettlement.getStash("PerkBuyer");
        assert.deepEqual([...(snapshot.oneTimePerks ?? [])].sort(), [
            "firepower",
            "steelskin",
        ]);
        assert.equal(snapshot.items.perks.firepower, undefined);

        console.log(
            "One-time perk stash test passed: purchase stores without equipping, only manual selections are consumed, and crash recovery preserves the separate inventory.",
        );
    } finally {
        removeTestData();
    }
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});
