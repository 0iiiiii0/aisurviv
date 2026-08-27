import assert from "node:assert/strict";
import { AchievementIds } from "../../shared/defs/achievementDefs.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Game } from "./game/game.ts";
import type { Player } from "./game/objects/player.ts";
import { stashManager } from "./stash/stashManager.ts";

function join(
    game: Game,
    token: string,
    name: string,
    serverBot: boolean,
    account = "",
): Player {
    game.addJoinToken(token, false, 1, 60_000, false, serverBot);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = name;
    msg.loadoutPriv = account;
    const player = game.playerBarn.addPlayer(`${token}-socket`, msg);
    if (!player) throw new Error(`failed to join ${name}`);
    return player;
}

void (async () => {
    const originalGrant = stashManager.grantAchievement.bind(stashManager);
    const awards: Array<{ name: string; id: string }> = [];
    const sentToHuman: ArrayBuffer[] = [];
    (stashManager as unknown as {
        grantAchievement(name: string, id: typeof AchievementIds.DuelDomination): {
            ok: boolean;
            awarded: boolean;
            achievements: typeof AchievementIds.DuelDomination[];
        };
    }).grantAchievement = (name, id) => {
        awards.push({ name, id });
        return { ok: true, awarded: true, achievements: [id] };
    };

    const game = new Game(
        `duel-achievement-${Date.now()}`,
        {
            mapName: "duel",
            teamMode: TeamMode.Solo,
            duelWeapons: ["m4a1", "mk12"],
            duelAiEnabled: true,
            duelAiDifficulty: "legit",
            duelDefaultLoadout: true,
        },
        (socketId, data) => {
            if (socketId === "human-socket") sentToHuman.push(data);
        },
        () => {},
    );
    try {
        await game.init();
        const human = join(game, "human", "Human", false, "AchievementAccount");
        const bot = join(game, "bot", "AI-legit", true);

        for (let round = 1; round <= 5; round++) {
            bot.damage({
                amount: 99999,
                damageType: GameConfig.DamageType.Player,
                dir: { x: 1, y: 0 },
                source: human,
                gameSourceType: human.activeWeapon,
            });
            if (round < 5) {
                assert(game.arenaMatch);
                game.arenaMatch.resetTicker = 0;
                game.update();
            }
        }

        assert.equal(game.over, true);
        assert.equal(game.arenaMatch?.scores.get(human.__id), 5);
        assert.equal(game.arenaMatch?.scores.get(bot.__id), 0);
        assert.deepEqual(awards, [
            { name: "AchievementAccount", id: AchievementIds.DuelDomination },
        ]);
        const unlocked = sentToHuman.some((buffer) => {
            const stream = new net.MsgStream(buffer);
            if (stream.deserializeMsgType() !== net.MsgType.AchievementUnlocked) {
                return false;
            }
            const msg = new net.AchievementUnlockedMsg();
            msg.deserialize(stream.stream);
            return msg.achievementId === AchievementIds.DuelDomination;
        });
        assert.equal(unlocked, true, "winner receives the unlock notification");
        console.log(
            "Duel achievement smoke test passed: authenticated human received 主宰 after an authoritative default-loadout LEGIT 5:0.",
        );
    } finally {
        (stashManager as unknown as { grantAchievement: typeof originalGrant })
            .grantAchievement = originalGrant;
        game.stop();
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
