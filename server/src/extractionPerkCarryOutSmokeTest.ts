import assert from "node:assert/strict";
import fs from "fs";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { RawGameObjectDefs as GameObjectDefs } from "../../shared/defs/gameObjectDefs.ts";
import type { GunDef } from "../../shared/defs/gameObjects/gunDefs.ts";
import {
    PERK_CARRY_OUT_EXTRA_MAX,
    PERK_CARRY_OUT_MAX,
    perkCarryOutCap,
} from "../../shared/defs/extractionDefs.ts";
import { getServerDataFilePath } from "./config.ts";
import { StashManager } from "./stash/stashManager.ts";
import { Game } from "./game/game.ts";
import type { JoinTokenData } from "./game/game.ts";
import { NoOpSocket } from "./game/socket.ts";

/**
 * 搜打撤/绝密能力带出规则回归测试（仅这两种模式生效，其他模式不受影响）：
 * - 带入 N 个能力 → 带出上限 = min(7, N + min(N-1, 3))：
 *   带入 1 → 1，2 → 3，3 → 5，4 → 7。
 * - 槽位在进局发放时按“实际带入数”锁定；局内丢掉旧能力不会增减带出槽位，
 *   也不会把丢掉的旧能力带出。
 */
async function main(): Promise<void> {
    // 1) 共享公式（客户端与服务端共用同一份）。
    const table: Array<[number, number]> = [
        [0, 0],
        [1, 1],
        [2, 3],
        [3, 5],
        [4, 7],
        [5, 7],
        [10, 7],
    ];
    for (const [n, cap] of table) {
        assert.equal(perkCarryOutCap(n), cap, `perkCarryOutCap(${n})`);
    }
    assert.equal(PERK_CARRY_OUT_EXTRA_MAX, 3, "max extra carry-out slots");
    assert.equal(PERK_CARRY_OUT_MAX, 7, "max total carry-out slots");

    // 2) grantLoadout 按实际带入数下发锁定的带出槽位。
    const file = getServerDataFilePath("survivio-stash-perk-test.json");
    try {
        fs.rmSync(file, { force: true });
    } catch {
        // ignore
    }
    const stash = new StashManager("survivio-stash-perk-test.json");
    try {
        const PERKS_4 = ["flak_jacket", "leadership", "firepower", "takedown"];
        for (const p of PERKS_4) {
            assert.equal(stash.addItem("perkP4", p, 1).ok, true);
        }
        assert.equal(
            stash
                .setLoadout("perkP4", {
                    guns: [],
                    ammo: {},
                    consumables: {},
                    perks: PERKS_4,
                    armor: {},
                })
                .ok,
            true,
        );
        const granted4 = stash.grantLoadout("perkP4");
        assert.ok(granted4, "4-perk loadout must be granted");
        assert.equal(granted4.perks?.length, 4);
        assert.equal(granted4.perkCarryOutCap, 7, "bring 4 -> carry out 7");

        // 带入 2 个 → 带出 3（独立玩家，避免与上一轮库存互相影响）。
        for (const p of ["flak_jacket", "leadership"]) {
            assert.equal(stash.addItem("perkP2", p, 1).ok, true);
        }
        assert.equal(
            stash
                .setLoadout("perkP2", {
                    guns: [],
                    ammo: {},
                    consumables: {},
                    perks: ["flak_jacket", "leadership"],
                    armor: {},
                })
                .ok,
            true,
        );
        const granted2 = stash.grantLoadout("perkP2");
        assert.ok(granted2, "2-perk loadout must be granted");
        assert.equal(granted2.perks?.length, 2);
        assert.equal(granted2.perkCarryOutCap, 3, "bring 2 -> carry out 3");
    } finally {
        try {
            fs.rmSync(file, { force: true });
        } catch {
            // ignore
        }
    }

    // 3) Player.perksToCarryOut()：槽位锁定；丢旧能力不增减槽位、不带出丢掉的。
    const game = new Game("extraction-perk", {
        mapName: "extraction",
        teamMode: TeamMode.Solo,
    });
    try {
        game.addJoinToken("perk-token", false, 1, 60_000, false, false, undefined);
        const msg = new net.JoinMsg();
        msg.protocol = GameConfig.protocolVersion;
        msg.matchPriv = "perk-token";
        msg.name = "PerkTester";
        msg.loadoutPriv = "PerkTester";
        msg.bot = false;
        const human = game.clientBarn.addClientWithPlayer(
            new NoOpSocket(),
            game.joinTokens.get(msg.matchPriv)?.data as JoinTokenData,
            msg,
            msg.matchPriv,
        )?.player;
        assert(human, "human must join");

        // 模拟带入 4 个 + 局内拾取 5 个：broughtInPerks 中带入的排前面。
        human.broughtInPerks = ["flak_jacket", "leadership", "firepower", "takedown"];
        human.perkCarryOutCap = perkCarryOutCap(4); // 进局时锁定 = 7（4 + 3）
        for (const p of ["windwalk", "lifeline", "field_medic", "combat_stims", "targeting"]) {
            human.broughtInPerks.push(p);
        }
        const out = human.perksToCarryOut();
        assert.equal(out.length, 7, "carry-out capped at locked 7");
        assert.deepEqual(
            out.slice(0, 4),
            ["flak_jacket", "leadership", "firepower", "takedown"],
            "brought-in perks are prioritized",
        );

        // 丢掉 2 个带入的能力：槽位仍是 7（不因丢掉增加/减少），丢掉的不会带出。
        human.broughtInPerks.splice(1, 2); // 丢掉 leadership, firepower
        const out2 = human.perksToCarryOut();
        assert.equal(out2.length, 7, "locked slots stay 7 after dropping");
        assert.ok(!out2.includes("leadership"), "dropped perk not carried out");
        assert.ok(!out2.includes("firepower"), "dropped perk not carried out");
        assert.ok(out2.includes("flak_jacket"), "kept brought-in perk carried out");
    } finally {
        game.stop();
    }

    // 3b) 手动选中的一次性能力会在本局生效，但保留一次性标记且撤离不回仓。
    const oneTimeGame = new Game("extraction-one-time-perk", {
        mapName: "extraction",
        teamMode: TeamMode.Solo,
    });
    try {
        oneTimeGame.addJoinToken("one-time-token", false, 1, 60_000, false, false, undefined);
        const msg = new net.JoinMsg();
        msg.protocol = GameConfig.protocolVersion;
        msg.matchPriv = "one-time-token";
        msg.name = "OneTimePerkTester";
        msg.loadoutPriv = "OneTimePerkTester";
        msg.bot = false;
        const human = oneTimeGame.clientBarn.addClientWithPlayer(
            new NoOpSocket(),
            oneTimeGame.joinTokens.get(msg.matchPriv)?.data as JoinTokenData,
            msg,
            msg.matchPriv,
        )?.player;
        assert(human, "one-time perk human must join");

        human.applyExtractionLoadout({
            perks: ["flak_jacket"],
            oneTimePerks: ["firepower"],
            perkCarryOutCap: perkCarryOutCap(2),
        });
        assert.ok(human.hasPerk("flak_jacket"), "permanent selected perk is active");
        assert.ok(human.hasPerk("firepower"), "selected one-time perk is active");
        assert.equal(
            human.perks.find((perk) => perk.type === "firepower")?.isOneTime,
            true,
            "one-time perk keeps its non-recoverable marker",
        );
        assert.equal(human.perkCarryOutCap, 3, "both selected perks determine the locked cap");
        assert.deepEqual(
            human.perksToCarryOut(),
            ["flak_jacket"],
            "one-time perk is excluded from extraction recovery",
        );

        const lootCountBeforeDrop = oneTimeGame.lootBarn.loots.length;
        const dropMsg = new net.DropItemMsg();
        dropMsg.item = "firepower";
        human.dropItem(dropMsg);
        const droppedOneTimePerk = oneTimeGame.lootBarn.loots
            .slice(lootCountBeforeDrop)
            .find((loot) => loot.type === "firepower");
        assert.equal(
            droppedOneTimePerk?.oneTimePerk,
            true,
            "manually dropped one-time perk keeps its marker",
        );
        assert.ok(droppedOneTimePerk, "manual drop creates one-time perk loot");
        human.pickupTicker = 0;
        human.pickupLoot(droppedOneTimePerk);
        assert.equal(
            human.perks.find((perk) => perk.type === "firepower")?.isOneTime,
            true,
            "picking up the dropped perk preserves its one-time marker",
        );

        // A picked-up one-time perk is replaceable. Replacing it must not wash
        // the dropped copy into a permanent perk for the next player.
        human.perkCarryOutCap = 2;
        const lootCountBeforeReplace = oneTimeGame.lootBarn.loots.length;
        oneTimeGame.lootBarn.addLoot("targeting", human.pos, human.layer, 1);
        const replacement = oneTimeGame.lootBarn.loots[lootCountBeforeReplace];
        human.pickupTicker = 0;
        human.pickupLoot(replacement);
        const replacedOneTimePerk = oneTimeGame.lootBarn.loots
            .slice(lootCountBeforeReplace + 1)
            .find((loot) => loot.type === "firepower");
        assert.equal(
            replacedOneTimePerk?.oneTimePerk,
            true,
            "replaced one-time perk keeps its marker",
        );
    } finally {
        oneTimeGame.stop();
    }

    // 4) 局内拾取绝不替换带入的能力（搜打撤/绝密）：先新增到带出上限，满了只替换局内拾取的。
    const pickupGame = new Game("extraction-perk-pickup", {
        mapName: "extraction",
        teamMode: TeamMode.Solo,
    });
    try {
        pickupGame.addJoinToken("pickup-token", false, 1, 60_000, false, false, undefined);
        const msg = new net.JoinMsg();
        msg.protocol = GameConfig.protocolVersion;
        msg.matchPriv = "pickup-token";
        msg.name = "PickupTester";
        msg.loadoutPriv = "PickupTester";
        msg.bot = false;
        const human = pickupGame.clientBarn.addClientWithPlayer(
            new NoOpSocket(),
            pickupGame.joinTokens.get(msg.matchPriv)?.data as JoinTokenData,
            msg,
            msg.matchPriv,
        )?.player;
        assert(human, "human must join");

        // 模拟带入 4 个能力（与 applyExtractionLoadout 一致）。
        const BROUGHT = ["flak_jacket", "leadership", "firepower", "takedown"];
        human.broughtInPerks = [...BROUGHT];
        human.perkCarryOutCap = perkCarryOutCap(BROUGHT.length); // 7
        for (const perkType of BROUGHT) {
            human.addPerk(perkType, true);
            const entry = human.perks[human.perks.length - 1];
            if (entry) entry.isBroughtIn = true;
        }

        const pickUp = (type: string): void => {
            const before = pickupGame.lootBarn.loots.length;
            pickupGame.lootBarn.addLoot(type, { x: 300, y: 300 }, 0, 1);
            const loot = pickupGame.lootBarn.loots[before];
            human.pickupTicker = 0;
            human.pickupLoot(loot);
        };

        // 拾取 3 个局内能力：应新增（不替换带入），共穿戴 7 个（带出上限 = 4 + 3）。
        for (const found of ["windwalk", "lifeline", "field_medic"]) pickUp(found);
        assert.equal(human.perks.length, 7, "4 brought-in + 3 found = 7 worn");
        for (const perkType of BROUGHT) {
            assert.ok(human.hasPerk(perkType), `brought-in ${perkType} must stay equipped`);
        }
        assert.equal(human.broughtInPerks.length, 7, "carry-out set = 4 brought-in + 3 found");

        // 再拾取 1 个：已满（7 = 带出上限）→ 只替换局内拾取的能力，带入的必须保留。
        pickUp("combat_stims");
        assert.equal(human.perks.length, 7, "still 7 worn at cap");
        for (const perkType of BROUGHT) {
            assert.ok(human.hasPerk(perkType), `brought-in ${perkType} must survive pickup at cap`);
        }
        assert.ok(human.hasPerk("combat_stims"), "new found perk equipped at cap");
        assert.equal(human.broughtInPerks.length, 7, "carry-out set stays at cap after swap");
        assert.ok(human.broughtInPerks.includes("combat_stims"), "new found perk in carry-out set");
    } finally {
        pickupGame.stop();
    }

    // 5) 无限子弹（仅搜打撤/绝密）：.338（AWM-S/AWC）恢复由无限子弹供给，信号弹仍不适用；
    //    由技能产生的弹药/投掷物撤离时不回仓库。
    const invGame = new Game("extraction-perk-inv", {
        mapName: "extraction",
        teamMode: TeamMode.Solo,
    });
    try {
        invGame.addJoinToken("inv-token", false, 1, 60_000, false, false, undefined);
        const msg = new net.JoinMsg();
        msg.protocol = GameConfig.protocolVersion;
        msg.matchPriv = "inv-token";
        msg.name = "InvTester";
        msg.loadoutPriv = "InvTester";
        msg.bot = false;
        const human = invGame.clientBarn.addClientWithPlayer(
            new NoOpSocket(),
            invGame.joinTokens.get(msg.matchPriv)?.data as JoinTokenData,
            msg,
            msg.matchPriv,
        )?.player;
        assert(human, "human must join");

        // .338（awc）恢复无限供给；信号弹枪仍消耗真实弹药。
        human.addPerk("endless_ammo", false);
        assert.equal(
            human.weaponManager.isInfinite(GameObjectDefs["awc"] as GunDef),
            true,
            "endless_ammo must supply .338 (AWM-S/AWC) in extraction",
        );
        assert.equal(
            human.weaponManager.isInfinite(GameObjectDefs["flare_gun"] as GunDef),
            false,
            "endless_ammo must NOT supply flare ammo in extraction",
        );

        // 无限子弹：只带回带入的弹药；局内捡的（技能供给）超额弹药不回仓；信号弹正常带回。
        human.broughtAmmo = { "762mm": 100, flare: 5 };
        human.invManager.set("762mm", 600); // 带入 100 + 局内 500
        human.invManager.set("flare", 8); // 带入 5 + 局内 3（信号弹不受无限子弹影响）
        human.invManager.set("frag", 6);
        human.invManager.set("bandage", 4);
        const outInv = human.carryOutInventory();
        assert.equal(outInv["762mm"], 100, "endless_ammo: only brought ammo returns");
        assert.equal(outInv.flare, 8, "flare ammo returns fully (not covered by infinite)");
        assert.equal(outInv.bandage, 4, "non-ammo items return normally");

        // 投掷物补充（fabricate）：技能产生的碎片雷不回仓；未产生的部分正常带回。
        human.perkProducedThrowables = { frag: 4 };
        const outInv2 = human.carryOutInventory();
        assert.equal(outInv2.frag, 2, "fabricate-produced frags do not return (6-4)");

        // 没有技能时：全部物资正常带回（回归）。
        human.removePerk("endless_ammo");
        human.perkProducedThrowables = {};
        const outInv3 = human.carryOutInventory();
        assert.equal(outInv3["762mm"], 600, "without endless_ammo all ammo returns");
        assert.equal(outInv3.frag, 6, "without fabricate all frags return");
    } finally {
        invGame.stop();
    }

    // 6) 没带入能力的玩家，局内也可穿戴到 7 个 buff（捡起新增、不替换）。
    const zeroGame = new Game("extraction-perk-zero", {
        mapName: "extraction",
        teamMode: TeamMode.Solo,
    });
    try {
        zeroGame.addJoinToken("zero-token", false, 1, 60_000, false, false, undefined);
        const msg = new net.JoinMsg();
        msg.protocol = GameConfig.protocolVersion;
        msg.matchPriv = "zero-token";
        msg.name = "ZeroTester";
        msg.loadoutPriv = "ZeroTester";
        msg.bot = false;
        const human = zeroGame.clientBarn.addClientWithPlayer(
            new NoOpSocket(),
            zeroGame.joinTokens.get(msg.matchPriv)?.data as JoinTokenData,
            msg,
            msg.matchPriv,
        )?.player;
        assert(human, "human must join");
        human.perkCarryOutCap = 0; // 未带入能力

        const pickUp = (type: string): void => {
            const before = zeroGame.lootBarn.loots.length;
            zeroGame.lootBarn.addLoot(type, { x: 300, y: 300 }, 0, 1);
            human.pickupTicker = 0;
            human.pickupLoot(zeroGame.lootBarn.loots[before]);
        };
        // 未带入能力：局内带出槽位为 0，但保留 1 个基础槽位可临时用；
        // 之后再捡只替换局内拾取的，数量保持 1。
        for (const found of [
            "windwalk",
            "lifeline",
            "field_medic",
            "combat_stims",
            "targeting",
        ]) {
            pickUp(found);
        }
        assert.equal(
            human.perks.length,
            1,
            "0 brought-in -> 1 base in-game buff slot",
        );
        assert.ok(human.hasPerk("targeting"), "latest found perk equipped");
        // 兜底：即使 cap 为 0（未带入/槽位未下发），已收集的能力也要能带出，
        // 绝不能整批丢失（“所有技能无法带出”回归）。
        assert.equal(
            human.perksToCarryOut().length,
            1,
            "0-brought-in player must still carry out collected perks (fallback)",
        );
        assert.ok(
            human.perksToCarryOut().includes("targeting"),
            "fallback carries out the collected perk",
        );
    } finally {
        zeroGame.stop();
    }

    console.log(
        "Extraction perk carry-out smoke test passed: cap=min(7, 2N-1), locked at grant, drops don't add slots, in-game pickups never replace brought-in perks, in-game cap follows carry-out cap, infinite-ammo/.338 and perk-produced items don't return to stash.",
    );
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});
