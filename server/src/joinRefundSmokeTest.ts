import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Config } from "./config.ts";
import { stashManager } from "./stash/stashManager.ts";
import { Game } from "./game/game.ts";
import type { Player } from "./game/objects/player.ts";

const prevSecret = JSON.parse(JSON.stringify(Config.extractionSecret)) as typeof Config.extractionSecret;
Config.extractionSecret.enabled = false;

void (async () => {
    const stash = stashManager;
    stash.removePlayer("JRT");
    stash.removePlayer("JRT2");
    const game = new Game(
        `join-refund-${Math.random().toString(36).slice(2)}`,
        { mapName: "extraction", teamMode: TeamMode.Solo },
        () => {},
        () => {},
    );
    await game.init();
    const g = game as unknown as {
        started: boolean;
        startedTime: number;
        applyExtractionSpawnLoadout(p: Player): void;
    };
    g.started = true;
    g.startedTime = 0;
    try {
        // 配装进局。
        stash.addItem("JRT", "m4a1", 1);
        stash.addItem("JRT", "firepower", 1);
        stash.setLoadout("JRT", {
            guns: ["m4a1", ""],
            ammo: {},
            consumables: {},
            armor: {},
            perks: ["firepower"],
        });
        game.addJoinToken("jr-token", false, 1, 60_000, false, false, undefined);
        const msg = new net.JoinMsg();
        msg.protocol = GameConfig.protocolVersion;
        msg.matchPriv = "jr-token";
        msg.name = "JRT";
        msg.loadoutPriv = "JRT";
        const p = game.playerBarn.addPlayer("jr-sock", msg);
        assert.ok(p, "joined");
        g.applyExtractionSpawnLoadout(p);
        // 进局前装备已扣。
        assert.equal(stash.getStash("JRT").items.guns.m4a1, undefined, "m4a1 已扣");
        assert.equal(stash.getStash("JRT").items.perks.firepower, undefined, "firepower 已扣");

        // 未真正进局（timeAlive=0）被移除 → 装备归还。
        game.playerBarn.removePlayer(p);
        assert.equal(stash.getStash("JRT").items.guns.m4a1, 1, "未进局移除后 m4a1 归还");
        assert.equal(stash.getStash("JRT").items.perks.firepower, 1, "未进局移除后 firepower 归还");
        console.log("✓ removed before entering match → loadout refunded");

        // 再次进局 → 有残留 pending 时先归还旧记录（防覆盖丢失）。
        stash.addItem("JRT2", "scar", 1);
        stash.setLoadout("JRT2", {
            guns: ["scar", ""],
            ammo: {},
            consumables: {},
            armor: {},
        });
        game.addJoinToken("jr-token2", false, 1, 60_000, false, false, undefined);
        const msg2 = new net.JoinMsg();
        msg2.protocol = GameConfig.protocolVersion;
        msg2.matchPriv = "jr-token2";
        msg2.name = "JRT2";
        msg2.loadoutPriv = "JRT2";
        const p2 = game.playerBarn.addPlayer("jr-sock2", msg2);
        assert.ok(p2, "joined 2");
        g.applyExtractionSpawnLoadout(p2);
        assert.equal(stash.getStash("JRT2").items.guns.scar, undefined, "scar 已扣");
        // 残留 pending 存在时再次 grant → 旧 pending 归还 + 新扣一次（净剩 0）。
        const grantedAgain = stash.grantLoadout("JRT2");
        assert.ok(grantedAgain, "二次 grant 执行");
        assert.equal(
            Number(stash.getStash("JRT2").items.guns.scar ?? 0),
            0,
            "残留 pending 先归还后重扣（净 0，不凭空丢失）",
        );
        console.log("✓ stale pending refunded before re-grant (no equipment lost)");

        console.log("\nJoin-refund test passed.");
    } finally {
        game.stop();
        Config.extractionSecret = prevSecret;
        stashManager.removePlayer("JRT");
        stashManager.removePlayer("JRT2");
    }
})();
