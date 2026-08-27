import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Config } from "./config.ts";
import { stashManager } from "./stash/stashManager.ts";
import { buyOneTimePerk } from "./economy/shopManager.ts";
import { Game } from "./game/game.ts";
import { NoOpSocket } from "./game/socket.ts";
import type { JoinTokenData } from "./game/game.ts";
import type { Player } from "./game/objects/player.ts";

const prevSecret = JSON.parse(JSON.stringify(Config.extractionSecret)) as typeof Config.extractionSecret;
Config.extractionSecret.enabled = true;
Config.shop.oneTimePerkPrice = 3000;
Config.shop.oneTimePerkBanned = ["scavenger", "scavenger_adv"];

function join(game: Game, name: string): Player {
    game.addJoinToken(`sl-${name}`, false, 1, 60_000, false, false, undefined);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = `sl-${name}`;
    msg.name = name;
    msg.loadoutPriv = name;
    const data = game.joinTokens.get(msg.matchPriv)?.data as JoinTokenData;
    return game.clientBarn.addClientWithPlayer(new NoOpSocket(), data, msg, msg.matchPriv)!.player!;
}

void (async () => {
    const game = new Game("oneTimePerkStashSmokeTest.ts-live", {
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
        // 0) 清理残留测试数据。
        stashManager.removePlayer("SLT");
        // 1) 购买 2 个一次性能力 → 存入仓库（不自动装配）。
        stashManager.addCoins("SLT", 6000);
        assert.ok(buyOneTimePerk("SLT", "firepower").ok, "购买 firepower");
        assert.ok(buyOneTimePerk("SLT", "steelskin").ok, "购买 steelskin");
        const stash = stashManager.getStash("SLT");
        assert.deepEqual(stash.oneTimePerks, ["firepower", "steelskin"], "购买后全部在仓库");

        // 2) 配装只勾选 1 个（steelskin）；配装保存前未选中不消耗。
        stashManager.addItem("SLT", "m4a1", 1);
        stashManager.setLoadout("SLT", {
            guns: ["m4a1", ""],
            ammo: {},
            consumables: {},
            armor: {},
            perks: [],
            oneTimePerks: ["steelskin"],
        });
        const stash2 = stashManager.getStash("SLT");
        assert.deepEqual(stash2.oneTimePerks, ["firepower", "steelskin"], "配装不消耗仓库");
        assert.deepEqual(stash2.loadout.oneTimePerks, ["steelskin"], "配装记录选中");

        // 3) 进局：只消耗选中的 steelskin；firepower 留在仓库。
        const p = join(game, "SLT");
        g.applyExtractionSpawnLoadout(p);
        const stash3 = stashManager.getStash("SLT");
        assert.deepEqual(
            (stash3 as unknown as { oneTimePerks?: string[] }).oneTimePerks,
            ["firepower"],
            "未选中的 firepower 保留在仓库",
        );
        assert.deepEqual(stash3.loadout.oneTimePerks, [], "本次选择已清空");
        // 槽位：普通 0 + 选中 1 → 带入 N=1 → cap=1。
        assert.equal(p.perkCarryOutCap, 1, "槽位按选中数计算");

        // 4) 第二局：配装选 firepower → 进局消耗它（直接 grantLoadout 验证）。
        // 新版账本：上次进局的待结算（steelskin）先自动归还仓库，再消耗本次
        // 选择的 firepower（进入 pending，撤离/结算时才真正销毁）。
        stashManager.setLoadout("SLT", {
            guns: ["m4a1", ""],
            ammo: {},
            consumables: {},
            armor: {},
            perks: [],
            oneTimePerks: ["firepower"],
        });
        stashManager.addItem("SLT", "m4a1", 1);
        const secondGrant = stashManager.grantLoadout("SLT");
        assert.deepEqual(
            secondGrant?.oneTimePerks,
            ["firepower"],
            "第二次发放消耗选中的 firepower",
        );
        const stash4 = stashManager.getStash("SLT");
        assert.deepEqual(
            (stash4 as unknown as { oneTimePerks?: string[] }).oneTimePerks,
            ["steelskin"],
            "firepower 已消耗；上次待结算的 steelskin 已归还仓库",
        );
        // 结算后 pending 清空：firepower 不再出现在任何账本里。
        stashManager.clearPendingGrant("SLT");
        const stash5 = stashManager.getStash("SLT");
        assert.deepEqual(
            (stash5 as unknown as { oneTimePerks?: string[] }).oneTimePerks,
            ["steelskin"],
            "结算后仅剩未选中的 steelskin",
        );
        console.log("One-time perk stash selective-consume test passed.");
    } finally {
        game.stop();
        Config.extractionSecret = prevSecret;
        stashManager.removePlayer("SLT");
    }
})();
