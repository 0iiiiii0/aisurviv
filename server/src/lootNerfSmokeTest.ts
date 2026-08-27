import assert from "node:assert/strict";
import { TeamMode } from "../../shared/gameConfig.ts";
import { Game } from "./game/game.ts";

const RARE = new Set([
    // S+ / S 枪
    "awc", "m1014", "usas", "potato_cannon", "potato_smg",
    "m4a1", "m249", "mosin", "saiga", "spas12", "sv98", "scarssr",
    // 三级甲 / 头盔
    "helmet03", "chest03",
    // AWM 弹药 / 信号弹 / 信号枪
    "308sub", "flare", "flare_gun", "flare_gun_dual",
    // 8x / 15x 倍镜
    "8xscope", "15xscope",
]);

async function rareHitRate(
    mapName: "extraction" | "main",
    tier: string,
    count: number,
): Promise<number> {
    const game = new Game(
        `loot-${mapName}`,
        { mapName, teamMode: TeamMode.Solo },
        () => {},
        () => {},
    );
    await game.init();
    const barn = game.lootBarn as unknown as {
        getLootTable(tier: string): Array<{ name: string }>;
    };
    let hits = 0;
    for (let i = 0; i < count; i++) {
        for (const item of barn.getLootTable(tier)) {
            if (RARE.has(item.name)) hits += 1;
        }
    }
    game.stop();
    return hits / count;
}

async function itemHitRate(
    mapName: "extraction" | "main",
    tier: string,
    target: string,
    count: number,
): Promise<number> {
    const game = new Game(
        `loot-${mapName}`,
        { mapName, teamMode: TeamMode.Solo },
        () => {},
        () => {},
    );
    await game.init();
    const barn = game.lootBarn as unknown as {
        getLootTable(tier: string): Array<{ name: string }>;
    };
    let hits = 0;
    for (let i = 0; i < count; i++) {
        for (const item of barn.getLootTable(tier)) {
            if (item.name === target) hits += 1;
        }
    }
    game.stop();
    return hits / count;
}

void (async () => {
    const n = 3000;
    const extGuns = await rareHitRate("extraction", "tier_guns", n);
    const mainGuns = await rareHitRate("main", "tier_guns", n);
    assert.ok(
        mainGuns > 0.003,
        `main rare gun rate must stay normal (got ${mainGuns})`,
    );
    assert.ok(
        extGuns < mainGuns * 0.2,
        `extraction rare gun rate must be much lower (ext ${extGuns} vs main ${mainGuns})`,
    );

    const extArmor = await rareHitRate("extraction", "tier_armor", n);
    const mainArmor = await rareHitRate("main", "tier_armor", n);
    assert.ok(
        mainArmor > 0.003,
        `main tier-3 armor rate must stay normal (got ${mainArmor})`,
    );
    assert.ok(
        extArmor < mainArmor * 0.2,
        `extraction tier-3 armor rate must be much lower (ext ${extArmor} vs main ${mainArmor})`,
    );

    const extScope = await rareHitRate("extraction", "tier_scopes", n);
    const mainScope = await rareHitRate("main", "tier_scopes", n);
    assert.ok(
        mainScope > 0.01,
        `main 8x/15x scope rate must stay normal (got ${mainScope})`,
    );
    assert.ok(
        extScope < mainScope * 0.2,
        `extraction 8x/15x scope rate must be much lower (ext ${extScope} vs main ${mainScope})`,
    );

    // 低/中档调整：搜打撤低级物资（C/D 枪、一级甲、常用药）掉率下降，
    // 中级物资（A/B 枪、中档药）掉率上升。
    const extM9 = await itemHitRate("extraction", "tier_guns", "m9", n);
    const mainM9 = await itemHitRate("main", "tier_guns", "m9", n);
    assert.ok(
        extM9 < mainM9,
        `extraction low-tier gun (m9) rate must drop (ext ${extM9.toFixed(4)} vs main ${mainM9.toFixed(4)})`,
    );
    const extAk = await itemHitRate("extraction", "tier_guns", "ak47", n);
    const mainAk = await itemHitRate("main", "tier_guns", "ak47", n);
    assert.ok(
        extAk > mainAk,
        `extraction mid-tier gun (ak47) rate must rise (ext ${extAk.toFixed(4)} vs main ${mainAk.toFixed(4)})`,
    );
    const extBandage = await itemHitRate("extraction", "tier_medical", "bandage", n);
    const mainBandage = await itemHitRate("main", "tier_medical", "bandage", n);
    assert.ok(
        extBandage < mainBandage,
        `extraction low-tier heal (bandage) rate must drop (ext ${extBandage.toFixed(4)} vs main ${mainBandage.toFixed(4)})`,
    );
    const extHealthkit = await itemHitRate("extraction", "tier_medical", "healthkit", n);
    const mainHealthkit = await itemHitRate("main", "tier_medical", "healthkit", n);
    assert.ok(
        extHealthkit > mainHealthkit,
        `extraction mid-tier heal (healthkit) rate must rise (ext ${extHealthkit.toFixed(4)} vs main ${mainHealthkit.toFixed(4)})`,
    );

    console.log(
        `Loot nerf smoke test passed: extraction rare loot suppressed (guns ${extGuns.toFixed(4)} vs ${mainGuns.toFixed(4)}, armor ${extArmor.toFixed(4)} vs ${mainArmor.toFixed(4)}, scopes ${extScope.toFixed(4)} vs ${mainScope.toFixed(4)}), low down / mid up (m9 ${extM9.toFixed(4)} vs ${mainM9.toFixed(4)}, ak47 ${extAk.toFixed(4)} vs ${mainAk.toFixed(4)}, bandage ${extBandage.toFixed(4)} vs ${mainBandage.toFixed(4)}, healthkit ${extHealthkit.toFixed(4)} vs ${mainHealthkit.toFixed(4)}), other modes untouched.`,
    );
})();
