import assert from "node:assert/strict";
import { AchievementIds } from "../../shared/defs/achievementDefs.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Game } from "./game/game.ts";
import type { Player } from "./game/objects/player.ts";
import { stashManager } from "./stash/stashManager.ts";

const originalGrant = stashManager.grantAchievement.bind(stashManager);

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

/** 模拟核爆任务完成：三元素放置 → 武装 → 倒计时立即到期。 */
function forceDetonate(game: Game): void {
    const z = game.zombieMode as unknown as {
        missionElements: Array<{ placed: boolean; carrierId: number }>;
        armMission(): void;
        shelterCountdownEndsAt: number;
    };
    for (const element of z.missionElements) {
        element.placed = true;
        element.carrierId = 0;
    }
    (z as unknown as { armMission(): void }).armMission();
    z.shelterCountdownEndsAt = Date.now() - 1;
}

function hasUnlockMsg(buffers: ArrayBuffer[], id: string): boolean {
    return buffers.some((buffer) => {
        const stream = new net.MsgStream(buffer);
        if (stream.deserializeMsgType() !== net.MsgType.AchievementUnlocked) {
            return false;
        }
        const msg = new net.AchievementUnlockedMsg();
        msg.deserialize(stream.stream);
        return msg.achievementId === id;
    });
}

async function runCase(opts: {
    difficulty: "simple" | "normal" | "hard";
    account: string;
    label: string;
}): Promise<{ awarded: boolean; notified: boolean }> {
    const awards: Array<{ name: string; id: string }> = [];
    (stashManager as unknown as {
        grantAchievement: typeof stashManager.grantAchievement;
    }).grantAchievement = (name, id) => {
        awards.push({ name, id });
        return { ok: true, awarded: true, achievements: [id] };
    };

    const sent: ArrayBuffer[] = [];
    const game = new Game(
        `zombie-nuke-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        { mapName: "zombie", teamMode: TeamMode.Solo, zombieDifficulty: opts.difficulty },
        (_socketId, data) => {
            sent.push(data);
        },
        () => {},
    );
    try {
        await game.init();
        const g = game as unknown as { started: boolean; startedTime: number };
        g.started = true;
        g.startedTime = 0;
        const human = join(game, "nuke", "Nuker", opts.account);
        human.pos.x = game.map.center.x;
        human.pos.y = game.map.center.y;
        human.layer = 1; // 躲入地堡
        forceDetonate(game);
        (game as unknown as { update(): void }).update();

        const awarded =
            awards.find((a) => a.id === AchievementIds.ZombieNuclearHard) !==
            undefined;
        const notified = hasUnlockMsg(sent, AchievementIds.ZombieNuclearHard);
        console.log(
            `  [${opts.label}] awarded=${awarded} notified=${notified} (${
                opts.difficulty
            } / account=${opts.account !== "" ? "yes" : "no"})`,
        );
        return { awarded, notified };
    } finally {
        (stashManager as unknown as {
            grantAchievement: typeof stashManager.grantAchievement;
        }).grantAchievement = originalGrant;
        game.stop();
    }
}

void (async () => {
    // 1. hard solo + 登录 → 授予 + 通知。
    const hard = await runCase({ difficulty: "hard", account: "NukeAccount", label: "hard solo logged-in" });
    assert.equal(hard.awarded, true, "hard solo awards 核爆");
    assert.equal(hard.notified, true, "winner receives unlock notification");

    // 2. normal solo → 不授予。
    const normal = await runCase({ difficulty: "normal", account: "NukeAccount", label: "normal solo" });
    assert.equal(normal.awarded, false, "normal does not award");
    assert.equal(normal.notified, false, "no notification on normal");

    // 3. hard solo 匿名（未登录）→ 不授予。
    const anon = await runCase({ difficulty: "hard", account: "", label: "hard solo anonymous" });
    assert.equal(anon.awarded, false, "anonymous player does not receive persistent achievement");

    console.log(
        "\nZombie nuclear achievement smoke test passed: hard-solo-only idempotent grant, account-bound, unlock notification.",
    );
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
