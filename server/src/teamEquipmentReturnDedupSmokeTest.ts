import assert from "node:assert/strict";
import fs from "node:fs";
import { getServerDataFilePath } from "./config.ts";
import { StashManager } from "./stash/stashManager.ts";

const testName = `.team-return-dedup-${process.pid}.json`;
const testFile = getServerDataFilePath(testName);
const cleanup = () => {
    for (const file of [testFile, `${testFile}.lock`, `${testFile}.tmp`]) {
        try {
            fs.unlinkSync(file);
        } catch {
            // 测试文件不存在时无需处理。
        }
    }
};

function grantGun(stash: StashManager, player: string, gun: string): number {
    const before = Number(stash.getStash(player).items.guns[gun] ?? 0);
    assert.equal(stash.addItem(player, gun, 1).ok, true);
    const configured = stash.setLoadout(player, {
        guns: [gun, ""],
        ammo: {},
        consumables: {},
        armor: {},
    });
    assert.equal(configured.ok, true, configured.reason);
    assert.ok(stash.grantLoadout(player));
    return before;
}

cleanup();
try {
    const stash = new StashManager(testName);

    // 队友先带出、原玩家后审批：从返还快照扣除，枪只进入队友仓库一次。
    const ownerBase = grantGun(stash, "DeadOwner", "m4a1");
    const carrierBase = grantGun(stash, "LivingCarrier", "ak47");
    const request = stash.archivePendingGrantForReturnRequest(
        "DeadOwner",
        "team-match-before-review",
        "extraction_secret",
    );
    assert.ok(request);
    assert.equal(
        stash.submitEquipmentReturnRequest(
            "DeadOwner",
            "team-match-before-review",
            "队友仍在继续对局",
        ).ok,
        true,
    );
    stash.collectCarriedLoot(
        "LivingCarrier",
        {
            weapons: ["ak47", "m4a1"],
            inventory: {},
        },
        {
            matchId: "team-match-before-review",
            teammateNames: ["DeadOwner"],
        },
    );
    stash.clearPendingGrant("LivingCarrier");
    const reconciled = stash.getEquipmentReturnRequest(
        "DeadOwner",
        "team-match-before-review",
    );
    assert.equal(reconciled?.grant.guns.m4a1, undefined);
    assert.equal(reconciled?.teammateCarriedItems?.m4a1, 1);
    assert.deepEqual(reconciled?.teammateCarriers, ["LivingCarrier"]);
    assert.equal(stash.reviewEquipmentReturnRequest(request!.id, "approve").ok, true);
    assert.equal(stash.getStash("DeadOwner").items.guns.m4a1 ?? 0, ownerBase);
    assert.equal(stash.getStash("LivingCarrier").items.guns.ak47, carrierBase + 1);
    assert.equal(stash.getStash("LivingCarrier").items.guns.m4a1, 1);

    // 原玩家先获批、队友后带出：已返还枪不会再次进入队友仓库。
    const earlyOwnerBase = grantGun(stash, "EarlyApprovedOwner", "ash12");
    grantGun(stash, "LateCarrier", "hk416");
    const earlyRequest = stash.archivePendingGrantForReturnRequest(
        "EarlyApprovedOwner",
        "team-match-after-review",
        "extraction_secret",
    );
    assert.ok(earlyRequest);
    assert.equal(
        stash.submitEquipmentReturnRequest(
            "EarlyApprovedOwner",
            "team-match-after-review",
            "提前申请",
        ).ok,
        true,
    );
    assert.equal(stash.reviewEquipmentReturnRequest(earlyRequest!.id, "approve").ok, true);
    assert.equal(
        stash.getStash("EarlyApprovedOwner").items.guns.ash12,
        earlyOwnerBase + 1,
    );
    const lateCarrierAshBefore = Number(
        stash.getStash("LateCarrier").items.guns.ash12 ?? 0,
    );
    stash.collectCarriedLoot(
        "LateCarrier",
        {
            weapons: ["hk416", "ash12"],
            inventory: {},
        },
        {
            matchId: "team-match-after-review",
            teammateNames: ["EarlyApprovedOwner"],
        },
    );
    assert.equal(
        stash.getStash("LateCarrier").items.guns.ash12 ?? 0,
        lateCarrierAshBefore,
        "已经批准返还的队友枪械不能再次由撤离者入库",
    );

    console.log(
        "Team equipment-return dedup smoke test passed: teammate-carried equipment is never granted twice, regardless of approval order.",
    );
} finally {
    cleanup();
}
