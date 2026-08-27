import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Config } from "./config.ts";
import { stashManager } from "./stash/stashManager.ts";
import { buyOneTimePerk, oneTimePerkCatalog } from "./economy/shopManager.ts";
import { Game } from "./game/game.ts";
import { NoOpSocket } from "./game/socket.ts";
import type { JoinTokenData } from "./game/game.ts";
import type { Player } from "./game/objects/player.ts";

const prevSecret = JSON.parse(JSON.stringify(Config.extractionSecret)) as typeof Config.extractionSecret;
Config.extractionSecret.enabled = true;
Config.shop.oneTimePerkPrice = 3000;
Config.shop.oneTimePerkBanned = ["scavenger", "scavenger_adv"];

function join(game: Game, name: string): Player {
    game.addJoinToken(`ml-${name}`, false, 1, 60_000, false, false, undefined);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = `ml-${name}`;
    msg.name = name;
    msg.loadoutPriv = name;
    const data = game.joinTokens.get(msg.matchPriv)?.data as JoinTokenData;
    return game.clientBarn.addClientWithPlayer(new NoOpSocket(), data, msg, msg.matchPriv)!.player!;
}

void (async () => {
    const game = new Game("multiOneTimePerkSmokeTest.ts-live", {
        mapName: "extraction",
        teamMode: TeamMode.Solo,
    });
    const g = game as unknown as {
        started: boolean;
        startedTime: number;
        applyExtractionSpawnLoadout(p: Player): void;
    };
    g.started = true;
    g.startedTime = 0;
    try {
        stashManager.removePlayer("MLT");

        // 1) 购买 2 个同类型（firepower ×2）→ 都进仓库。
        stashManager.addCoins("MLT", 3000 * 6);
        assert.ok(buyOneTimePerk("MLT", "firepower").ok, "购买 firepower #1");
        assert.ok(buyOneTimePerk("MLT", "firepower").ok, "购买 firepower #2 不拒绝");
        let stash = stashManager.getStash("MLT");
        assert.deepEqual(stash.oneTimePerks, ["firepower", "firepower"], "同类 2 个都在仓库");
        console.log("✓ 同类型购买 2 个成功，仓库:", stash.oneTimePerks.length, "个");

        // 2) 目录显示持有数量 2。
        const cat = oneTimePerkCatalog("MLT");
        const fp = cat.items.find((i) => i.type === "firepower");
        assert.equal(fp?.owned, 2, "目录 owned=2");
        console.log("✓ 目录显示仓库 x2");

        // 3) 配装勾选 firepower → 进局消耗 1 个 → 剩 1 个。
        stashManager.addItem("MLT", "m4a1", 1);
        stashManager.setLoadout("MLT", {
            guns: ["m4a1", ""],
            ammo: {},
            consumables: {},
            armor: {},
            oneTimePerks: ["firepower"],
        });
        const p = join(game, "MLT");
        g.applyExtractionSpawnLoadout(p);
        stash = stashManager.getStash("MLT");
        assert.deepEqual(
            (stash as unknown as { oneTimePerks?: string[] }).oneTimePerks,
            ["firepower"],
            "进局消耗 1 个，剩 1 个",
        );
        assert.equal(p.perkCarryOutCap, 1, "选中 1 个 → 槽位 1");
        assert.equal(
            oneTimePerkCatalog("MLT").items.find((i) => i.type === "firepower")
                ?.owned,
            2,
            "对局待结算 1 个 + 仓库剩余 1 个，目录仍显示完整持有数 2",
        );
        console.log("✓ 进局消耗 1 个，仓库剩 1 个");

        // 4) 第二局：配装再勾选 → 消耗最后 1 个 → 清空。
        //    测试环境 Game Ended 后假 socket 无正常结算，pendingGrants 残留
        //    （归还后库存虚增 1）；先清除 pending 模拟正常结算，再开新局。
        stashManager.clearPendingGrant("MLT");
        stashManager.setLoadout("MLT", {
            guns: ["m4a1", ""],
            ammo: {},
            consumables: {},
            armor: {},
            oneTimePerks: ["firepower"],
        });
        stashManager.addItem("MLT", "m4a1", 1);
        const grant2 = stashManager.grantLoadout("MLT");
        stash = stashManager.getStash("MLT");
        assert.equal(
            (stash as unknown as { oneTimePerks?: string[] }).oneTimePerks,
            undefined,
            "第二局消耗后仓库清空",
        );
        // 对局未结算时目录仍显示 owned=1（pending 保护，防重复购买）；
        // 结算（clearPendingGrant）后归 0。
        assert.equal(
            oneTimePerkCatalog("MLT").items.find((i) => i.type === "firepower")?.owned,
            1,
            "未结算时目录 owned=1（pending 保护）",
        );
        stashManager.clearPendingGrant("MLT");
        const cat2 = oneTimePerkCatalog("MLT");
        assert.equal(cat2.items.find((i) => i.type === "firepower")?.owned, 0, "结算后目录 owned=0");
        console.log("✓ 两局消耗完，结算后目录归 0");

        // 5) 库存 0 时配装勾选被拒绝（幽灵清理）。
        stashManager.setLoadout("MLT", {
            guns: ["m4a1", ""],
            ammo: {},
            consumables: {},
            armor: {},
            oneTimePerks: ["firepower"],
        });
        const saved = stashManager.getStash("MLT").loadout.oneTimePerks ?? [];
        assert.equal(saved.length, 0, "无库存时配装无法勾选");
        console.log("✓ 无库存时配装勾选被清理");

        console.log("\nMultiple same-type one-time perk purchase test passed.");
    } finally {
        game.stop();
        Config.extractionSecret = prevSecret;
        stashManager.removePlayer("MLT");
    }
})();
