import assert from "assert";
import fs from "fs";
import { getServerDataFilePath } from "./config.ts";
import { StashManager } from "./stash/stashManager.ts";

const testName = `.equipment-return-smoke-${process.pid}.json`;
const testFile = getServerDataFilePath(testName);
const lockFile = `${testFile}.lock`;

function cleanup(): void {
    for (const file of [testFile, lockFile, `${testFile}.tmp`]) {
        try {
            fs.unlinkSync(file);
        } catch {
            // 测试文件不存在时无需处理。
        }
    }
}

function prepareLoadout(stash: StashManager, name: string): void {
    assert(stash.addItem(name, "m4a1", 1).ok);
    assert(stash.addItem(name, "556mm", 60).ok);
    assert(stash.addItem(name, "bandage", 5).ok);
    assert(stash.addItem(name, "helmet01", 1).ok);
    assert(stash.addItem(name, "firepower", 1).ok);
    const configured = stash.setLoadout(name, {
        guns: ["m4a1", ""],
        ammo: { "556mm": 60 },
        consumables: { bandage: 5 },
        perks: ["firepower"],
        armor: { helmet: "helmet01" },
    });
    assert(configured.ok, configured.reason);
    assert(stash.grantLoadout(name), "配装应成功发放并生成 pendingGrant");
}

cleanup();
try {
    const player = "ReturnSmokePlayer";
    const stash = new StashManager(testName);
    prepareLoadout(stash, player);

    assert.strictEqual(stash.getStash(player).items.guns.m4a1 ?? 0, 0);
    const archived = stash.archivePendingGrantForReturnRequest(
        player,
        "match-approve",
        "extraction_secret",
    );
    assert.strictEqual(archived?.status, "eligible");
    assert.strictEqual(archived?.grant.guns.m4a1, 1);

    // 待玩家申请的快照已经从 pendingGrant 分离，服务器重启不能自动返还。
    const restarted = new StashManager(testName);
    assert.strictEqual(restarted.recoverPendingGrants(), 0);
    assert.strictEqual(restarted.getStash(player).items.guns.m4a1 ?? 0, 0);
    assert.strictEqual(
        restarted.submitEquipmentReturnRequest("OtherPlayer", "match-approve", "冒领").reason,
        "not-eligible",
    );
    assert.strictEqual(
        restarted.submitEquipmentReturnRequest(player, "match-approve", "  ").reason,
        "reason-required",
    );

    const submitted = restarted.submitEquipmentReturnRequest(
        player,
        "match-approve",
        "对局异常结束，请核查并返还",
    );
    assert(submitted.ok);
    assert.strictEqual(submitted.request?.status, "pending");
    assert(restarted.submitEquipmentReturnRequest(player, "match-approve", "重复").ok);

    const approvalNote = "  已核查服务器日志，本局带入装备已返还。  ";
    const approved = restarted.reviewEquipmentReturnRequest(
        submitted.request!.id,
        "approve",
        approvalNote,
    );
    assert(approved.ok);
    assert.strictEqual(approved.request?.status, "approved");
    assert.strictEqual(approved.request?.adminNote, approvalNote.trim());
    assert.strictEqual(
        approved.request?.notifiedAt,
        undefined,
        "normal approval must always create an unread menu notification",
    );
    assert.strictEqual(
        new StashManager(testName).getEquipmentReturnRequest(player, "match-approve")?.adminNote,
        approvalNote.trim(),
        "后台留言必须持久化到重启后的审批记录",
    );
    const afterApprove = restarted.getStash(player);
    assert.strictEqual(afterApprove.items.guns.m4a1, 1);
    assert.strictEqual(afterApprove.items.ammo["556mm"], 60);
    // 新建仓库自带 10 个绷带，本次带入的 5 个应原样加回为 15。
    assert.strictEqual(afterApprove.items.consumables.bandage, 15);
    // 新建仓库自带 2 个一级头盔，本次带入的 1 个返还后恢复为 3。
    assert.strictEqual(afterApprove.items.helmets.helmet01, 3);
    assert.strictEqual(afterApprove.items.perks.firepower, 1);

    // 审批通过后主页能读取一次成功返还通知；其它账号不能代为确认。
    const approvedNotifications =
        restarted.listEquipmentReturnNotifications(player);
    assert.strictEqual(approvedNotifications.length, 1);
    assert.strictEqual(approvedNotifications[0].status, "approved");
    assert.strictEqual(approvedNotifications[0].adminNote, approvalNote.trim());
    assert.strictEqual(
        restarted.acknowledgeEquipmentReturnNotifications("OtherPlayer", [
            approvedNotifications[0].id,
        ]),
        0,
    );
    assert.strictEqual(
        restarted.listEquipmentReturnNotifications(player).length,
        1,
        "未由本人确认前通知必须保留",
    );
    assert.strictEqual(
        restarted.acknowledgeEquipmentReturnNotifications(player, [
            approvedNotifications[0].id,
        ]),
        1,
    );
    assert.strictEqual(restarted.listEquipmentReturnNotifications(player).length, 0);
    assert.strictEqual(
        new StashManager(testName).listEquipmentReturnNotifications(player).length,
        0,
        "通知已读状态必须在服务器重启后保留",
    );

    // 重复点击审批不得复制装备。
    const duplicate = restarted.reviewEquipmentReturnRequest(
        submitted.request!.id,
        "approve",
    );
    assert.strictEqual(duplicate.reason, "already-reviewed");
    assert.strictEqual(restarted.getStash(player).items.guns.m4a1, 1);

    // 拒绝路径保留审计记录，但不把装备返仓。
    const rejectedPlayer = "ReturnRejectPlayer";
    prepareLoadout(restarted, rejectedPlayer);
    const rejectedArchive = restarted.archivePendingGrantForReturnRequest(
        rejectedPlayer,
        "match-reject",
        "extraction_secret",
    );
    assert(rejectedArchive);
    const rejectedSubmit = restarted.submitEquipmentReturnRequest(
        rejectedPlayer,
        "match-reject",
        "普通阵亡",
    );
    assert(rejectedSubmit.ok);
    const rejectionNote = "证据不足，本次不予返还；如有录像请重新提交。";
    assert(
        restarted.reviewEquipmentReturnRequest(
            rejectedSubmit.request!.id,
            "reject",
            rejectionNote,
        ).ok,
    );
    assert.strictEqual(restarted.getStash(rejectedPlayer).items.guns.m4a1 ?? 0, 0);
    const rejectedRequest = restarted.getEquipmentReturnRequest(
        rejectedPlayer,
        "match-reject",
    );
    assert.strictEqual(rejectedRequest?.status, "rejected");
    assert.strictEqual(rejectedRequest?.adminNote, rejectionNote);
    assert.strictEqual(
        restarted.listEquipmentReturnNotifications(rejectedPlayer).length,
        0,
        "拒绝申请不能显示装备已返还提示",
    );

    // 留言是可选字段：空白留言不应写入；超长留言必须截断到 300 字。
    const noNotePlayer = "ReturnNoNotePlayer";
    prepareLoadout(restarted, noNotePlayer);
    assert(restarted.archivePendingGrantForReturnRequest(
        noNotePlayer,
        "match-no-note",
        "extraction",
    ));
    const noNoteSubmit = restarted.submitEquipmentReturnRequest(
        noNotePlayer,
        "match-no-note",
        "测试可选留言",
    );
    assert(noNoteSubmit.ok);
    const noNoteReview = restarted.reviewEquipmentReturnRequest(
        noNoteSubmit.request!.id,
        "reject",
        "   ",
    );
    assert(noNoteReview.ok);
    assert.strictEqual(noNoteReview.request?.adminNote, undefined);

    const longNotePlayer = "ReturnLongNotePlayer";
    prepareLoadout(restarted, longNotePlayer);
    assert(restarted.archivePendingGrantForReturnRequest(
        longNotePlayer,
        "match-long-note",
        "extraction",
    ));
    const longNoteSubmit = restarted.submitEquipmentReturnRequest(
        longNotePlayer,
        "match-long-note",
        "测试留言长度限制",
    );
    assert(longNoteSubmit.ok);
    const longNote = "长".repeat(380);
    const longNoteReview = restarted.reviewEquipmentReturnRequest(
        longNoteSubmit.request!.id,
        "reject",
        longNote,
    );
    assert(longNoteReview.ok);
    assert.strictEqual(longNoteReview.request?.adminNote?.length, 300);

    // 服务器卡顿局：自动返仓与禁止申请凭证必须原子落盘。
    const lagPlayer = "ReturnServerLagPlayer";
    prepareLoadout(restarted, lagPlayer);
    assert.strictEqual(restarted.getStash(lagPlayer).items.guns.m4a1 ?? 0, 0);
    const lagRefund = restarted.recoverPendingGrantForServerLag(
        lagPlayer,
        "match-server-lag",
        "extraction_secret",
    );
    assert.strictEqual(lagRefund.refunded, true);
    assert.strictEqual(lagRefund.request?.status, "auto-refunded");
    assert.match(lagRefund.request?.reason ?? "", /已自动返回仓库/);
    assert.strictEqual(restarted.getStash(lagPlayer).items.guns.m4a1, 1);

    // 服务器重启后仍能告知玩家；POST 无论是否填写理由均明确拒绝。
    const lagRestarted = new StashManager(testName);
    assert.strictEqual(
        lagRestarted.getEquipmentReturnRequest(lagPlayer, "match-server-lag")?.status,
        "auto-refunded",
    );
    assert.strictEqual(
        lagRestarted.submitEquipmentReturnRequest(
            lagPlayer,
            "match-server-lag",
            "请再次返还",
        ).reason,
        "server-lag-auto-refunded",
    );
    const lagNotifications =
        lagRestarted.listEquipmentReturnNotifications(lagPlayer);
    assert.strictEqual(lagNotifications.length, 1);
    assert.strictEqual(lagNotifications[0].status, "auto-refunded");
    assert.strictEqual(
        lagRestarted.acknowledgeEquipmentReturnNotifications(lagPlayer, [
            lagNotifications[0].id,
        ]),
        1,
    );
    assert.strictEqual(
        lagRestarted.listEquipmentReturnNotifications(lagPlayer).length,
        0,
    );
    assert.strictEqual(
        lagRestarted.reviewEquipmentReturnRequest(
            lagRefund.request!.id,
            "approve",
        ).reason,
        "already-reviewed",
    );
    const duplicateLagRefund = lagRestarted.recoverPendingGrantForServerLag(
        lagPlayer,
        "match-server-lag",
        "extraction_secret",
    );
    assert.strictEqual(duplicateLagRefund.refunded, false);
    assert.strictEqual(
        lagRestarted.getStash(lagPlayer).items.guns.m4a1,
        1,
        "重复卡顿结算不得复制装备",
    );

    // 删除账号时连同申请凭证一起清理，避免同名新账号继承历史申请。
    assert(restarted.removePlayer(player).ok);
    assert(restarted.removePlayer(rejectedPlayer).ok);
    assert(restarted.removePlayer(lagPlayer).ok);
    assert(restarted.removePlayer(noNotePlayer).ok);
    assert(restarted.removePlayer(longNotePlayer).ok);
    assert.strictEqual(restarted.getEquipmentReturnRequest(player, "match-approve"), null);
    assert.strictEqual(restarted.getEquipmentReturnRequest(rejectedPlayer, "match-reject"), null);
    assert.strictEqual(restarted.getEquipmentReturnRequest(lagPlayer, "match-server-lag"), null);
    assert.strictEqual(restarted.getEquipmentReturnRequest(noNotePlayer, "match-no-note"), null);
    assert.strictEqual(restarted.getEquipmentReturnRequest(longNotePlayer, "match-long-note"), null);

    console.log("equipment return request smoke test passed");
} finally {
    cleanup();
}
