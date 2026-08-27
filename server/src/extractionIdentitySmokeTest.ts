import assert from "node:assert/strict";
import fs from "fs";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { getServerDataFilePath } from "./config.ts";
import { StashManager } from "./stash/stashManager.ts";
import { Game } from "./game/game.ts";

// 跨层守卫：客户端加入对局时必须以新登录系统的账号显示名作为仓库身份
// （JoinMsg.loadoutPriv），而不是旧 Account.loadoutPriv（恒为空串）。
// 否则服务器 grantLoadout 拿不到配装 -> 玩家空手进绝密且装备不被消耗。
{
    const mainSource = fs.readFileSync(
        require("path").join(__dirname, "..", "..", "client", "src", "main.ts"),
        "utf8",
    );
    assert.match(
        mainSource,
        /this\.playerAccount\.loadoutPriv/,
        "join must send the account stash identity (playerAccount.loadoutPriv), not the legacy Account.loadoutPriv",
    );
    const accountSource = fs.readFileSync(
        require("path").join(__dirname, "..", "..", "client", "src", "playerAccount.ts"),
        "utf8",
    );
    assert.match(
        accountSource,
        /return this\.displayName \|\| this\.username \|\| "";/,
        "stash identity must fall back to the username like the server's displayName||username key",
    );
}

/**
 * 回归测试：搜打撤（含绝密）"起了装备进绝密却空手"。
 *
 * 背景：登录玩家可以设置与账号显示名不同的对局昵称（nickname），而仓库/配装
 * 始终绑定登录账号显示名。客户端通过 JoinMsg.loadoutPriv 携带账号显示名作为
 * "仓库身份"，服务器发放配装、撤离结算、崩溃回滚都必须使用该身份，而不是
 * 对局昵称 player.name。
 *
 * 修复前：grantLoadout(昵称) 找不到配装 -> 玩家空手进绝密，且撤离物资写入错误身份。
 */
async function main(): Promise<void> {
    // 1) 仓库身份 = 账号显示名，持有配装；对局昵称不是仓库键。
    const file = getServerDataFilePath("survivio-stash-identity-test.json");
    try {
        fs.rmSync(file, { force: true });
    } catch {
        // ignore
    }
    const stash = new StashManager("survivio-stash-identity-test.json");
    try {
        assert.equal(stash.addItem("AccountName", "ak47", 1).ok, true);
        assert.equal(stash.addItem("AccountName", "762mm", 90).ok, true);
        const loadoutResult = stash.setLoadout("AccountName", {
            guns: ["ak47"],
            ammo: { "762mm": 90 },
            consumables: {},
            armor: {},
        });
        assert.equal(loadoutResult.ok, true);
        // 新玩家自带新手包（ak47 x2），再手动加 1 把 -> 3 把。
        assert.equal(stash.getStash("AccountName").items.guns.ak47, 3);

        // 旧 bug：按对局昵称发放 -> 找不到配装 -> 空手。
        assert.equal(
            stash.grantLoadout("Nickname"),
            null,
            "in-game nickname must NOT be the stash key",
        );
        // 正确：按账号显示名（仓库身份）发放 -> 拿到配置的武器。
        const granted = stash.grantLoadout("AccountName");
        assert.ok(granted, "account identity must grant the configured loadout");
        assert.equal(granted.weapons[0]?.type, "ak47");
        assert.equal(
            stash.getStash("AccountName").items.guns.ak47,
            2,
            "grant must deduct exactly one gun from the account stash",
        );
    } finally {
        try {
            fs.rmSync(file, { force: true });
        } catch {
            // ignore
        }
    }

    // 2) Player.stashName 由 JoinMsg.loadoutPriv 决定（回退到昵称）。
    const game = new Game(
        "extraction-identity",
        { mapName: "extraction", teamMode: TeamMode.Solo },
        () => {},
        () => {},
    );
    await game.init();
    try {
        game.addJoinToken("human-token", false, 1, 60_000, false, false, undefined);
        const msg = new net.JoinMsg();
        msg.protocol = GameConfig.protocolVersion;
        msg.matchPriv = "human-token";
        msg.name = "Nickname"; // 对局内昵称
        msg.loadoutPriv = "AccountName"; // 账号显示名（仓库身份）
        msg.bot = false;
        const human = game.playerBarn.addPlayer("human-socket", msg);
        assert(human, "human must join");
        assert.equal(
            human.stashName,
            "AccountName",
            "stashName must come from loadoutPriv, not the nickname",
        );

        // 回退：未登录 / 机器人 loadoutPriv 为空 -> stashName = 昵称（原行为）。
        game.addJoinToken("legacy-token", false, 1, 60_000, false, false, undefined);
        const legacyMsg = new net.JoinMsg();
        legacyMsg.protocol = GameConfig.protocolVersion;
        legacyMsg.matchPriv = "legacy-token";
        legacyMsg.name = "LegacyPlayer";
        legacyMsg.bot = false;
        const legacy = game.playerBarn.addPlayer("legacy-socket", legacyMsg);
        assert(legacy, "legacy human must join");
        assert.equal(legacy.stashName, "LegacyPlayer");
    } finally {
        // no-op: keep the same lifecycle as other smoke tests
    }

    console.log(
        "Extraction identity smoke test passed: stash identity (loadoutPriv) is decoupled from the in-game nickname.",
    );
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});
