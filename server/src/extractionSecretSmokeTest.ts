import assert from "node:assert/strict";
import fs from "node:fs";
import {
    EXTRACTION_HOLD_SECONDS,
    EXTRACTION_SECRET_OPEN_SECONDS,
} from "../../shared/defs/extractionDefs.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Config, getServerDataFilePath } from "./config.ts";
import { stashManager } from "./stash/stashManager.ts";
import { Game } from "./game/game.ts";
import { NoOpSocket } from "./game/socket.ts";
import type { JoinTokenData } from "./game/game.ts";
import { SECRET_DROP_PERKS } from "./game/objects/player.ts";
import { RawGameObjectDefs as GameObjectDefs } from "../../shared/defs/gameObjectDefs.ts";
import {
    getSecretEligibleCatalog,
    isSecretEligibleWeapon,
} from "./duelWeapons.ts";

const RARE = new Set([
    "awc", "m1014", "usas", "potato_cannon", "potato_smg",
    "m4a1", "m249", "mosin", "saiga", "spas12", "sv98", "scarssr",
    "helmet03", "chest03", "308sub", "flare", "flare_gun", "flare_gun_dual",
    "8xscope", "15xscope",
]);

async function makeGame(secret = false): Promise<Game> {
    const game = new Game("extraction-secret", {
        mapName: "extraction",
        teamMode: TeamMode.Solo,
        // 显式绝密快照：与生产 gameManager 按 mapName 推导一致，
        // 不再依赖全局 Config.extractionSecret.enabled 回退。
        extractionSecretEnabled: secret,
    });
    return game;
}

async function rareRate(count: number, secret = false): Promise<number> {
    const game = await makeGame(secret);
    const barn = game.lootBarn as unknown as {
        getLootTable(tier: string): { name: string } | undefined;
    };
    let hits = 0;
    for (let i = 0; i < count; i++) {
        // 新 API：每次调用做一次加权抽取，返回单个条目（可能 undefined）。
        const item = barn.getLootTable("tier_guns");
        if (item && RARE.has(item.name)) hits += 1;
    }
    game.stop();
    return hits / count;
}

const previous = { ...Config.extractionSecret };
const previousSecretLoadouts = Config.extractionSecretAiLoadouts;
const realStashFile = getServerDataFilePath("survivio-stash.json");
const stashBackupFile = getServerDataFilePath("survivio-secret-test-backup.json");
if (fs.existsSync(realStashFile)) fs.copyFileSync(realStashFile, stashBackupFile);
void (async () => {
    try {
        // 0) 绝密进入资格判定。
        assert.equal(isSecretEligibleWeapon("m4a1"), true, "S 级突击步枪合格");
        assert.equal(isSecretEligibleWeapon("m249"), true, "S 级机枪合格");
        assert.equal(isSecretEligibleWeapon("awc"), true, "S+ 级狙击枪合格");
        assert.equal(isSecretEligibleWeapon("vector"), true, "A 级冲锋枪合格");
        assert.equal(isSecretEligibleWeapon("deagle"), false, "单持 A 级手枪不合格");
        assert.equal(isSecretEligibleWeapon("p30l"), false, "单持 A 级手枪不合格");
        assert.equal(isSecretEligibleWeapon("deagle_dual"), true, "双持 A 级手枪合格");
        assert.equal(isSecretEligibleWeapon("p30l_dual"), true, "双持 A 级手枪合格");
        assert.equal(isSecretEligibleWeapon("ash12"), true, "新加入的 S+ 级 ASh-12 合格");
        assert.equal(isSecretEligibleWeapon("potato_lmg"), true, "新加入的 S+ 级 PMG-134 合格");
        assert.equal(isSecretEligibleWeapon("spas16"), true, "新加入的 S 级 SPAS-16 合格");
        assert.equal(isSecretEligibleWeapon("barrett"), true, "新加入的 S 级 Barrett M107 合格");
        assert.equal(isSecretEligibleWeapon("sw500"), false, "新加入的 A 级单持手枪 S&W 500 不合格");
        assert.equal(isSecretEligibleWeapon("imbel"), false, "新加入的 B 级 IMD-2 不合格");
        assert.equal(isSecretEligibleWeapon("ak47"), false, "B 级不合格");
        assert.equal(isSecretEligibleWeapon("mp5"), false, "B 级不合格");
        const catalog = getSecretEligibleCatalog();
        assert.ok(catalog.length >= 20, "eligible catalog should cover A/S/S+ weapons");
        assert.ok(
            catalog.every((weapon) => weapon.image.startsWith("/img/loot/")),
            "catalog weapons must carry loot images",
        );

        // 随机天赋池必须完整：覆盖除平衡性排除项外的全部合法能力。
        // scavenger / scavenger_adv（拾荒）在搜打撤里严重影响平衡，已从池中移除。
        const EXCLUDED_POOL_PERKS = new Set(["scavenger", "scavenger_adv"]);
        const allPerks = Object.entries(GameObjectDefs)
            .filter(([, def]) => def.type === "perk")
            .map(([id]) => id)
            .filter((id) => !EXCLUDED_POOL_PERKS.has(id));
        const poolSet = new Set(SECRET_DROP_PERKS);
        const missingPerks = allPerks.filter((perk) => !poolSet.has(perk));
        assert.equal(
            missingPerks.length,
            0,
            `secret random perk pool must cover every valid perk (missing: ${missingPerks.join(", ")})`,
        );
        assert.equal(
            poolSet.size,
            allPerks.length,
            "secret random perk pool must not contain invalid/duplicate entries",
        );
        for (const excluded of EXCLUDED_POOL_PERKS) {
            assert.equal(
                poolSet.has(excluded),
                false,
                `secret random perk pool must exclude ${excluded} (balance)`,
            );
        }

        // 1) 绝密 AI 进局套用：无限子弹保留，不再套用最终幸存者 buff；
        //    每个 AI 随机拥有一个可掉落的 SECRET_DROP_PERKS 能力（真实生效）。
        Config.extractionSecret.enabled = true;
        // 固定绝密配装：避免随机抽到 helmet03 的“绝密重装”导致护甲断言不稳定。
        Config.extractionSecretAiLoadouts = [
            {
                name: "测试",
                weight: 100,
                loadout: {
                    guns: ["m4a1"],
                    ammo: { "556mm": 180 },
                    consumables: { bandage: 6 },
                    armor: {
                        helmet: "helmet02",
                        chest: "chest02",
                        backpack: "backpack02",
                    },
                },
            },
        ];
        const game = await makeGame(true);
        game.addJoinToken("bot-token", true, 1, 60_000, false, true, undefined);
        const msg = new net.JoinMsg();
        msg.protocol = GameConfig.protocolVersion;
        msg.matchPriv = "bot-token";
        msg.name = "SecretBot";
        const bot = game.clientBarn.addClientWithPlayer(
            new NoOpSocket(),
            game.joinTokens.get(msg.matchPriv)?.data as JoinTokenData,
            msg,
            msg.matchPriv,
        )?.player;
        assert(bot, "secret AI must join");
        (
            game as unknown as {
                applyExtractionSpawnLoadout(p: typeof bot): void;
            }
        ).applyExtractionSpawnLoadout(bot);
        assert.ok(bot.hasPerk("endless_ammo"), "secret AI must have endless ammo");
        assert.ok(
            bot.secretDropPerk && bot.hasPerk(bot.secretDropPerk),
            "secret AI must actually possess the perk it will drop",
        );
        // 不再套用最终幸存者 buff：除无限子弹和随机掉落能力外没有其他能力
        // （掉落能力可以是 SECRET_DROP_PERKS 里的任意一个，包括 steelskin/splinter）。
        for (const perk of bot.perks) {
            assert.ok(
                perk.type === "endless_ammo" ||
                    perk.type === bot.secretDropPerk ||
                    perk.type === bot.secretNonDropPerk,
                `secret AI must NOT carry unexpected perk ${perk.type} (last_man buff removed)`,
            );
        }
        assert.ok(bot.weapons[0]?.type, "secret AI must carry a primary weapon");
        // 搜打撤双模式（普通 / 绝密）：信号弹（flare）不享受无限子弹；
        // .338（308sub，AWM-S/AWC）已恢复由无限子弹供给。
        const wm = bot.weaponManager;
        const awcDef = GameObjectDefs["awc"] as Parameters<
            typeof wm.isInfinite
        >[0];
        const flareDef = GameObjectDefs["flare_gun"] as Parameters<
            typeof wm.isInfinite
        >[0];
        const m4a1Def = GameObjectDefs["m4a1"] as Parameters<
            typeof wm.isInfinite
        >[0];
        assert.equal(
            wm.isInfinite(awcDef),
            true,
            "AWM-S (.338) must be supplied by endless ammo in extraction modes",
        );
        assert.equal(
            wm.isInfinite(flareDef),
            false,
            "Flare gun must consume real ammo in extraction modes",
        );
        assert.equal(
            wm.isInfinite(m4a1Def),
            true,
            "regular guns keep endless ammo",
        );
        // 绝密 AI 装备的护甲（头盔/胸甲/背包）死亡掉落时降一级。
        assert.equal(bot.helmet, "helmet02", "secret AI wears level-2 helmet");
        assert.equal(bot.chest, "chest02", "secret AI wears level-2 chest");
        assert.equal(bot.backpack, "backpack02", "secret AI wears level-2 backpack");
        const lootBefore = game.lootBarn.loots.length;
        bot.kill({
            amount: 0,
            damageType: GameConfig.DamageType.Player,
            dir: { x: 1, y: 0 },
            source: undefined,
        });
        const droppedGear = game.lootBarn.loots
            .slice(lootBefore)
            .map((loot) => loot.type)
            .filter((t) => /^(chest|helmet|backpack)\d+$/.test(t));
        assert.deepEqual(
            droppedGear.sort(),
            ["backpack01", "chest01", "helmet01"],
            "secret AI armor must drop one level lower (2 -> 1)",
        );
        game.stop();

        // 2) 绝密模式高级物资掉率应明显高于普通搜打撤（普通被 V236 降权）。
        Config.extractionSecret.enabled = false;
        const normal = await rareRate(15000, false);
        Config.extractionSecret.enabled = true;
        const secret = await rareRate(15000, true);
        assert.ok(
            normal < secret,
            `secret mode must boost rare loot (normal ${normal.toFixed(4)} vs secret ${secret.toFixed(4)})`,
        );

        // 3) 绝密模式：撤离点前 5 分钟关闭，5 分钟后开放。
        const game2 = await makeGame(true);
        game2.addJoinToken("human-token", false, 1, 60_000, false, false, undefined);
        // 服务端绝密资格校验：人类玩家需配装合格武器（A/S/S+）才能加入。
        stashManager.addItem("SecretHuman", "m4a1", 1);
        stashManager.setLoadout("SecretHuman", {
            guns: ["m4a1", ""],
            ammo: {},
            consumables: {},
            armor: {},
        });
        const humanMsg = new net.JoinMsg();
        humanMsg.protocol = GameConfig.protocolVersion;
        humanMsg.matchPriv = "human-token";
        humanMsg.name = "SecretHuman";
        humanMsg.loadoutPriv = "SecretHuman";
        const human = game2.clientBarn.addClientWithPlayer(
            new NoOpSocket(),
            game2.joinTokens.get(humanMsg.matchPriv)?.data as JoinTokenData,
            humanMsg,
            humanMsg.matchPriv,
        )?.player;
        assert(human, "human must join for extraction lock test");
        (
            game2 as unknown as {
                applyExtractionSpawnLoadout(p: typeof human): void;
            }
        ).applyExtractionSpawnLoadout(human);
        const pt = game2.extraction().activePointFor(human);
        human.pos.x = pt.x;
        human.pos.y = pt.y;
        const state = game2 as unknown as { started: boolean; startedTime: number };
        state.started = true;
        state.startedTime = 100; // 前 5 分钟
        const steps = Math.ceil(EXTRACTION_HOLD_SECONDS / (1 / 30)) + 5;
        for (let i = 0; i < steps; i++) game2.extraction().update(1 / 30);
        assert.equal(
            human.dead,
            false,
            "extraction point must be locked in the first 5 minutes",
        );
        state.startedTime = EXTRACTION_SECRET_OPEN_SECONDS + 1; // 5 分钟后
        for (let i = 0; i < steps; i++) game2.extraction().update(1 / 30);
        assert.equal(
            human.dead,
            true,
            "extraction point must open after 5 minutes",
        );
        game2.stop();

        console.log(
            `Extraction secret smoke test passed: eligibility (${catalog.length} weapons), secret AI kit (endless ammo + possessed drop perk), armor drop downgrade, 5-min extraction lock, rare loot boosted x12 (${normal.toFixed(4)} -> ${secret.toFixed(4)}).`,
        );
    } finally {
        Config.extractionSecret = previous;
            Config.extractionSecretAiLoadouts = previousSecretLoadouts;
        if (fs.existsSync(stashBackupFile)) {
            fs.copyFileSync(stashBackupFile, realStashFile);
            fs.rmSync(stashBackupFile, { force: true });
        }
    }
})();
