import assert from "node:assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Config } from "./config.ts";
import { Game } from "./game/game.ts";
import { NoOpSocket } from "./game/socket.ts";
import type { JoinTokenData } from "./game/game.ts";

/**
 * V248 绝密 AI 与普通 AI 使用不同的配装：
 * - 普通搜打撤 AI 用 extractionAiLoadouts（低配：1~2 级护甲）；
 * - 绝密 AI 用 extractionSecretAiLoadouts（高配：2 级护甲 + A/S 武器 + 倍镜），
 *   并额外套用最终幸存者能力。
 */

async function makeGame(secret = false): Promise<Game> {
    const game = new Game(
        `secret-loadout-${Math.random().toString(36).slice(2)}`,
        {
            mapName: "extraction",
            teamMode: TeamMode.Solo,
            // 显式绝密快照：与生产 gameManager 按 mapName 推导一致，
            // 不再依赖全局 Config.extractionSecret.enabled 回退。
            extractionSecretEnabled: secret,
        },
    );
    return game;
}

function joinBot(game: Game, index: number) {
    const token = `secret-loadout-bot-${index}`;
    game.addJoinToken(token, true, 1, 60_000, false, true, undefined);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = `SecretLoadoutBot${index}`;
    const data = game.joinTokens.get(msg.matchPriv)?.data as JoinTokenData;
    return game.clientBarn.addClientWithPlayer(new NoOpSocket(), data, msg, msg.matchPriv)?.player;
}

const previous = { ...Config.extractionSecret };
const previousSecretLoadouts = Config.extractionSecretAiLoadouts;

// 测试钉死一套绝密配装，避免“3 套随机抽取导致断言不稳定”的 flaky 问题。
Config.extractionSecretAiLoadouts = [
    {
        name: "smoke-pinned-secret",
        weight: 1,
        loadout: {
            guns: ["m4a1"],
            ammo: { "556mm": 60 },
            consumables: { bandage: 2 },
            armor: {
                backpack: "backpack02",
                helmet: "helmet02",
                chest: "chest02",
                scope: "4xscope",
            },
        },
    },
];

void (async () => {
    try {
        const game = await makeGame(true);

        // 绝密模式：bot 使用被钉死的绝密配装（2 级护甲 + 绝密武器 + 倍镜）。
        Config.extractionSecret.enabled = true;
        const secretBot = joinBot(game, 0);
        assert(secretBot, "secret bot joins");
        (
            game as unknown as {
                applyExtractionSpawnLoadout(p: typeof secretBot): void;
            }
        ).applyExtractionSpawnLoadout(secretBot);
        assert.equal(
            secretBot.helmet,
            "helmet02",
            "pinned secret preset (level-2) armor must be respected (helmet)",
        );
        assert.equal(
            secretBot.chest,
            "chest02",
            "pinned secret preset (level-2) armor must be respected (chest)",
        );
        assert.equal(
            secretBot.backpack,
            "backpack02",
            "pinned secret preset (level-2) armor must be respected (backpack)",
        );
        assert.equal(
            secretBot.weapons[0]?.type,
            "m4a1",
            "pinned secret preset must grant m4a1 (got " + secretBot.weapons[0]?.type + ")",
        );
        assert.ok(
            secretBot.scope === "4xscope",
            "pinned secret preset must grant the 4x scope (got " + secretBot.scope + ")",
        );
        assert.ok(
            secretBot.hasPerk("endless_ammo"),
            "secret AI keeps infinite ammo (endless_ammo)",
        );
        const endlessPerk = secretBot.perks.find((p) => p.type === "endless_ammo");
        assert.ok(
            endlessPerk && endlessPerk.droppable === false,
            "endless ammo must NOT drop on death",
        );
        assert.ok(
            secretBot.secretDropPerk && secretBot.hasPerk(secretBot.secretDropPerk),
            "secret AI must actually possess the perk it will drop",
        );
        // 不再套用最终幸存者 buff：除无限子弹和随机掉落能力外没有其他能力
        // （掉落能力可以是 SECRET_DROP_PERKS 里的任意一个，包括 endless_ammo）。
        for (const perk of secretBot.perks) {
            assert.ok(
                perk.type === "endless_ammo" ||
                    perk.type === secretBot.secretDropPerk ||
                    perk.type === secretBot.secretNonDropPerk,
                `secret AI must NOT carry unexpected perk ${perk.type} (last_man buff removed)`,
            );
        }
        assert.ok(
            secretBot.perks.every((p) => p.droppable === false),
            "secret AI kit perks (endless ammo + drop perk) are non-droppable",
        );

        // 后台配置 3 级甲：进局必须穿 3 级甲（不再被压成 2 级甲），
        // 死亡掉落按"降一级"规则掉 2 级甲。
        const game3 = await makeGame(true);
        Config.extractionSecretAiLoadouts = [
            {
                name: "smoke-pinned-secret-3",
                weight: 1,
                loadout: {
                    guns: ["m249"],
                    ammo: { "556mm": 120 },
                    consumables: { bandage: 2 },
                    armor: {
                        backpack: "backpack03",
                        helmet: "helmet03",
                        chest: "chest03",
                        scope: "2xscope",
                    },
                },
            },
        ];
        const secretBot3 = joinBot(game3, 0);
        assert(secretBot3, "level-3 secret bot joins");
        (
            game3 as unknown as {
                applyExtractionSpawnLoadout(p: typeof secretBot3): void;
            }
        ).applyExtractionSpawnLoadout(secretBot3);
        assert.equal(
            secretBot3.helmet,
            "helmet03",
            "configured level-3 helmet must be equipped (no forced downgrade to level-2)",
        );
        assert.equal(
            secretBot3.chest,
            "chest03",
            "configured level-3 chest must be equipped",
        );
        assert.equal(
            secretBot3.backpack,
            "backpack03",
            "configured level-3 backpack must be equipped",
        );
        const loot3Before = game3.lootBarn.loots.length;
        secretBot3.kill({
            amount: 0,
            damageType: GameConfig.DamageType.Player,
            dir: { x: 1, y: 0 },
            source: undefined,
        });
        const droppedGear3 = game3.lootBarn.loots
            .slice(loot3Before)
            .map((loot) => loot.type)
            .filter((t) => /^(chest|helmet|backpack)\d+$/.test(t));
        assert.deepEqual(
            droppedGear3.sort(),
            ["backpack02", "chest02", "helmet02"],
            "level-3 secret AI armor must drop one level lower (3 -> 2)",
        );
        game3.stop();

        // 普通模式：bot 使用普通配装（1~2 级护甲，不用绝密配装）。
        Config.extractionSecret.enabled = false;
        const normalGame = await makeGame(false);
        const normalBot = joinBot(normalGame, 1);
        assert(normalBot, "normal bot joins");
        (
            normalGame as unknown as {
                applyExtractionSpawnLoadout(p: typeof normalBot): void;
            }
        ).applyExtractionSpawnLoadout(normalBot);
        assert.notEqual(
            normalBot.helmet,
            "helmet03",
            "normal AI must NOT get the secret level-3 helmet",
        );
        assert.notEqual(
            normalBot.chest,
            "chest03",
            "normal AI must NOT get the secret level-3 chest",
        );
        assert.notEqual(
            normalBot.weapons[0]?.type,
            "m4a1",
            "normal AI must come from the normal (non-secret) loadout presets",
        );
        normalGame.stop();

        console.log(
            "Extraction secret loadout smoke test passed: secret AI uses independent high-tier loadout, normal AI uses the normal loadout.",
        );
    } finally {
        Config.extractionSecret = previous;
        Config.extractionSecretAiLoadouts = previousSecretLoadouts;
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
