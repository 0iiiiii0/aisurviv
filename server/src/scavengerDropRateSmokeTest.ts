import assert from "node:assert/strict";
import {
    EXTRACTION_SCAVENGER_DROP_CHANCE,
    scavengerBonusDropChance,
    shouldSpawnScavengerBonus,
} from "./game/scavengerDropPolicy.ts";
import { extractionLootWeight } from "./game/objects/loot.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { Game } from "./game/game.ts";
import type { Player } from "./game/objects/player.ts";

function join(game: Game, id: string): Player {
    const token = `scavenger-${id}`;
    // 服务端 bot 不受绝密入口的真人武器门槛影响；这里只需要一个真实
    // Player 作为障碍物伤害来源，不测试玩家配装资格。
    game.addJoinToken(token, false, 1, 60_000, false, true, undefined);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = id;
    const player = game.playerBarn.addPlayer(`socket-${id}`, msg);
    assert(player, `player ${id} must join`);
    return player;
}

async function obstaclePathTriggers(
    mapName: "extraction" | "extraction_secret",
    perk: "scavenger" | "scavenger_adv",
    randomValue: number,
): Promise<boolean> {
    const game = new Game(
        `scavenger-path-${mapName}-${perk}-${randomValue}`,
        {
            mapName,
            teamMode: TeamMode.Solo,
            extractionBossEnabled: false,
        },
        () => {},
        () => {},
    );
    await game.init();
    try {
        const player = join(game, `${mapName}-${perk}-${randomValue}`);
        player.addPerk(perk);
        const expectedTier =
            perk === "scavenger_adv" ? "tier_scavenger_adv" : "tier_world";
        let skillRolls = 0;
        const getLootTable = game.lootBarn.getLootTable.bind(game.lootBarn);
        game.lootBarn.getLootTable = ((
            tier: string,
            visited?: Set<string>,
            options?: { applyExtractionSecretBonus?: boolean },
        ) => {
            if (tier === expectedTier && options?.applyExtractionSecretBonus === false) {
                skillRolls++;
            }
            return getLootTable(tier, visited, options);
        }) as typeof game.lootBarn.getLootTable;

        // tree_01 没有自身掉落，技能专用 roll 可与自然障碍物掉落完全隔离。
        const tree = game.map.genObstacle("tree_01", v2.create(30, 30), 0, 0, 1);
        const originalRandom = Math.random;
        Math.random = () => randomValue;
        try {
            tree.kill({
                damageType: GameConfig.DamageType.Player,
                dir: v2.create(1, 0),
                source: player,
                gameSourceType: player.activeWeapon,
            });
        } finally {
            Math.random = originalRandom;
        }
        return skillRolls === 1;
    } finally {
        game.stop();
    }
}

assert.equal(EXTRACTION_SCAVENGER_DROP_CHANCE, 0.05);
assert.equal(scavengerBonusDropChance(true, false), 0.05);
assert.equal(scavengerBonusDropChance(true, true), 1);
assert.equal(scavengerBonusDropChance(false, false), 1);

assert.equal(shouldSpawnScavengerBonus(true, false, () => 0.0499), true);
assert.equal(shouldSpawnScavengerBonus(true, false, () => 0.05), false);
assert.equal(shouldSpawnScavengerBonus(true, true, () => 0.9999), true);

assert.equal(
    extractionLootWeight("m249", 1, true, true, true),
    12,
    "secret map/world loot keeps the 12x rare-item bonus",
);
assert.equal(
    extractionLootWeight("m249", 1, true, true, false),
    1,
    "Scavenger perk rewards must not inherit the secret 12x rare-item bonus",
);
assert.equal(
    extractionLootWeight("m249", 1, true, false, false),
    0.1,
    "normal extraction rarity nerf remains unchanged",
);

// 固定均匀样本验证长期触发率（5% × 10000 = 500）。
let drops = 0;
const samples = 10_000;
for (let i = 0; i < samples; i++) {
    if (
        shouldSpawnScavengerBonus(
            true,
            false,
            () => (i + 0.5) / samples,
        )
    ) {
        drops++;
    }
}
assert.equal(drops, 500);

void (async () => {
    for (const perk of ["scavenger", "scavenger_adv"] as const) {
        assert.equal(
            await obstaclePathTriggers("extraction", perk, 0.0499),
            true,
            `${perk}: normal extraction must trigger below 5%`,
        );
        assert.equal(
            await obstaclePathTriggers("extraction", perk, 0.05),
            false,
            `${perk}: normal extraction must stop at the 5% boundary`,
        );
        assert.equal(
            await obstaclePathTriggers("extraction_secret", perk, 0.9999),
            true,
            `${perk}: secret extraction keeps its normal 100% trigger`,
        );
    }
    console.log(
        "Scavenger drop-rate smoke test passed: 5% in normal extraction; secret remains 100%.",
    );
})();
