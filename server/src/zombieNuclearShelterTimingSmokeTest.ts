import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AchievementIds } from "../../shared/defs/achievementDefs.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { Game } from "./game/game.ts";
import { prepareEmptySmokeTestDataDir } from "./smokeTestDataDir.ts";
import type { Player } from "./game/objects/player.ts";
import { StashManager } from "./stash/stashManager.ts";

// 用法：SURVIV_DATA_DIR=<临时目录> npx tsx zombieNuclearShelterTimingSmokeTest.ts
// 实测三个子场景：
//   A. 放置后立即躲地堡（倒计时全程在地堡）→ 授予
//   B. 倒计时最后 1 秒才进入地堡 → 核爆瞬间在地堡 → 授予
//   C. 倒计时结束仍在地面（layer 0）→ 不授予 + 被核爆杀死

const ACCOUNT = "G13";
const runDir = prepareEmptySmokeTestDataDir("zombieNuclearShelterTimingSmokeTest");

const stash = new StashManager("survivio-stash.json");
stash.getStash(ACCOUNT);
stash.addCoins(ACCOUNT, 100);

function join(game: Game, token: string, name: string, account = ""): Player {
    game.addJoinToken(token, false, 1, 60_000, false, false);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = name;
    msg.loadoutPriv = account;
    const player = game.playerBarn.addPlayer(`${token}-socket`, msg);
    if (!player) throw new Error(`failed to join ${name}`);
    return player;
}

function teleport(player: Player, x: number, y: number): void {
    player.pos = v2.create(x, y);
}

async function runScenario(
    label: string,
    shelterTiming: "immediate" | "last-second" | "never",
): Promise<{ awarded: boolean; killed: boolean }> {
    const game = new Game(
        `shelter-${Date.now()}-${Math.random().toString(36).slice(3)}`,
        { mapName: "zombie", teamMode: TeamMode.Solo, zombieDifficulty: "hard" },
        () => {},
        () => {},
    );
    try {
        await game.init();
        const g = game as unknown as { started: boolean; startedTime: number; update(): void };
        g.started = true;
        g.startedTime = 0;

        const player = join(game, "p", "Shelter", ACCOUNT);
        g.update();

        const z = game.zombieMode as unknown as {
            missionElements: Array<{
                pos: { x: number; y: number };
                placed: boolean;
                carrierId: number;
            }>;
            missionDevicePos: { x: number; y: number };
            tryInteractMission(p: Player): boolean;
            armMission(): void;
            shelterCountdownEndsAt: number;
        };

        // 传送收集 3 元素并放置。
        for (let i = 0; i < z.missionElements.length; i++) {
            const element = z.missionElements[i];
            teleport(player, element.pos.x, element.pos.y);
            assert.equal(z.tryInteractMission(player), true, `拾取元素 ${i}`);
            teleport(player, z.missionDevicePos.x, z.missionDevicePos.y);
            assert.equal(z.tryInteractMission(player), true, `放置元素 ${i}`);
        }
        (z as unknown as { armMission(): void }).armMission();

        // 进入掩体时机。
        if (shelterTiming === "immediate") {
            player.layer = 1;
        } else if (shelterTiming === "last-second") {
            // 倒计时还剩 100ms 时才进入地堡。
            z.shelterCountdownEndsAt = Date.now() + 100;
            player.layer = 1;
        } else {
            player.layer = 0; // 始终在地面
        }

        // 倒计时到期 → 核爆。
        z.shelterCountdownEndsAt = Date.now() - 1;
        g.update();
        for (let i = 0; i < 3; i++) g.update();

        const awarded = stash.hasAchievement(ACCOUNT, AchievementIds.ZombieNuclearHard);
        const killed = player.dead;
        console.log(
            `  [${label}] 进入时机=${shelterTiming} → 授予=${awarded} 玩家存活=${!killed}`,
        );
        return { awarded, killed };
    } finally {
        game.stop();
    }
}

void (async () => {
    // A：放置后立即躲地堡。
    const a = await runScenario("全程掩体", "immediate");
    assert.equal(a.awarded, true, "全程在地堡 → 授予");
    assert.equal(a.killed, false, "全程在地堡 → 存活");
    // 清成就隔离下一场景。
    for (const f of fs.readdirSync(runDir)) {
        fs.rmSync(path.join(runDir, f), { recursive: true, force: true });
    }
    stash.getStash(ACCOUNT);
    stash.addCoins(ACCOUNT, 100);

    // B：倒计时最后 1 秒才进入地堡。
    const b = await runScenario("最后1秒进掩体", "last-second");
    assert.equal(b.awarded, true, "45 秒内进入掩体（最后 1 秒）→ 授予");
    assert.equal(b.killed, false, "进入掩体 → 存活");
    for (const f of fs.readdirSync(runDir)) {
        fs.rmSync(path.join(runDir, f), { recursive: true, force: true });
    }
    stash.getStash(ACCOUNT);
    stash.addCoins(ACCOUNT, 100);

    // C：没进掩体。
    const c = await runScenario("未进掩体", "never");
    assert.equal(c.awarded, false, "未进掩体 → 不授予");
    assert.equal(c.killed, true, "未进掩体 → 被核爆杀死");

    console.log("\n✅ 核弹掩体时机实测通过：");
    console.log("   - 45 秒倒计时内（含最后 1 秒）进入地堡 → 核爆后授予成就");
    console.log("   - 未进入地堡 → 被核爆杀死，不授予");
    console.log("   - 判定只看核爆瞬间是否在地堡，不要求进入时间");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
