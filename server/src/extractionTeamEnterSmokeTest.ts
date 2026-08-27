import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Game } from "./game/game.ts";
import { prepareEmptySmokeTestDataDir } from "./smokeTestDataDir.ts";
import type { Player } from "./game/objects/player.ts";
import { StashManager } from "./stash/stashManager.ts";

// 用法：SURVIV_DATA_DIR=<临时目录> npx tsx extractionTeamEnterSmokeTest.ts
// 实测：搜打撤 duo/squad + 绝密搜打撤 duo/squad——同组 token 多名玩家
// 能否正常进入同一房间并分到同一队伍，特别覆盖绝密四人共享 token。

const runDir = prepareEmptySmokeTestDataDir("extractionTeamEnterSmokeTest");

const stash = new StashManager("survivio-stash.json");

function joinSameToken(
    game: Game,
    token: string,
    name: string,
    account: string,
): Player | undefined {
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = name;
    msg.loadoutPriv = account;
    return game.playerBarn.addPlayer(`${name}-socket`, msg);
}

async function runTeamCase(
    label: string,
    mapName: "extraction" | "extraction_secret",
    teamMode: TeamMode,
    accounts: string[],
): Promise<void> {
    const game = new Game(
        `team-${Date.now()}-${Math.random().toString(36).slice(3)}`,
        { mapName, teamMode },
        () => {},
        () => {},
    );
    try {
        await game.init();
        // 组队 token 的可用次数必须等于真实队伍人数。旧测试写死 2，
        // 导致绝密四排从未覆盖第 3/4 名玩家的进局路径。
        const token = `team-${Date.now()}`;
        game.addJoinToken(token, false, accounts.length, 60_000, false, false);

        const joined: Player[] = [];
        for (let i = 0; i < accounts.length; i++) {
            const p = joinSameToken(game, token, `P${i + 1}`, accounts[i]);
            if (p) joined.push(p);
        }

        assert.equal(
            joined.length,
            accounts.length,
            `${label}: 全部 ${accounts.length} 名玩家进入`,
        );
        // 同组：groupId 相同。
        const groupIds = new Set(joined.map((p) => p.groupId));
        assert.equal(
            groupIds.size,
            1,
            `${label}: 所有玩家同组 (groupId=${joined[0].groupId})`,
        );
        // 都活着、非 bot。
        for (const p of joined) {
            assert.equal(p.serverBot, false, `${label}: ${p.name} 是真人`);
            assert.equal(p.dead, false, `${label}: ${p.name} 存活`);
        }
        // 房间正常运行一帧。
        (game as unknown as { started: boolean; startedTime: number; update(): void }).started = true;
        (game as unknown as { startedTime: number }).startedTime = 0;
        (game as unknown as { update(): void }).update();

        console.log(
            `  [${label}] ${accounts.length} 人进入 ✓ 同组 groupId=${joined[0].groupId}，房间正常`,
        );
    } finally {
        game.stop();
    }
}

void (async () => {
    // 普通搜打撤 duo：G13 + 队友。
    stash.getStash("G13");
    stash.getStash("G13Teammate");
    await runTeamCase("搜打撤 duo", "extraction", TeamMode.Duo, ["G13", "G13Teammate"]);

    await runTeamCase(
        "搜打撤 squad",
        "extraction",
        TeamMode.Squad,
        ["G13", "G13Teammate", "G13Third", "G13Fourth"],
    );

    // 绝密搜打撤 duo/squad：所有真人都需要 A/S/S+ 武器配装。
    const secretAccounts = ["G13", "G13Teammate", "G13Third", "G13Fourth"];
    for (const acct of secretAccounts) {
        stash.getStash(acct);
        // 配装 S 级 m249 + 仓库实有。
        stash.addItem(acct, "m249", 1);
        stash.setLoadout(acct, {
            guns: ["m249", ""],
            ammo: {},
            consumables: {},
            throwables: {},
            perks: [],
            oneTimePerks: [],
            armor: {},
        });
    }
    await runTeamCase(
        "绝密搜打撤 duo",
        "extraction_secret",
        TeamMode.Duo,
        secretAccounts.slice(0, 2),
    );
    await runTeamCase(
        "绝密搜打撤 squad",
        "extraction_secret",
        TeamMode.Squad,
        secretAccounts,
    );

    console.log("\n✅ 多人组队搜打撤/绝密进入实测通过：");
    console.log("   - 搜打撤 duo：2 人同 token 全部进入、同组、房间正常");
    console.log("   - 搜打撤 squad：4 人同 token 全部进入、同组、房间正常");
    console.log("   - 绝密搜打撤 duo：2 人（A/S 武器配装）全部进入、同组、房间正常");
    console.log("   - 绝密搜打撤 squad：4 人（A/S 武器配装）全部进入、同组、房间正常");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
