import assert from "node:assert/strict";
import { TeamMode } from "../../shared/gameConfig.ts";
import { GunDefs } from "../../shared/defs/gameObjects/gunDefs.ts";
import { Game } from "./game/game.ts";

/**
 * 鍥炲綊娴嬭瘯锛氭悳鎵撴挙锛堟櫘閫?+ 缁濆瘑锛?瀛愬脊浜у嚭闄嶄綆 90%"蹇呴』瀹屾暣鐢熸晥锛? * 涓嶄粎浣滅敤浜?lootTable 鐙珛寮硅嵂锛屼篃浣滅敤浜?*浼撮殢姝﹀櫒鎺夎惤**鐨勫脊鑽? * 锛堟鍣ㄧ / 鍦板浘棰勭疆鏋 / 姝讳骸鎺夎惤鏋閮戒細璧?addLoot 鐨勫脊鑽檮甯﹂€昏緫锛夈€? *
 * 瑙勫垯涓?getLootTable 涓€鑷达細鏅€氬脊鑽紙9mm/45acp/12gauge/556mm/762mm锛壝?0锛? * 楂樼骇寮硅嵂锛?0AE/.338/淇″彿寮癸級梅5锛涘叾浠栨ā寮忎笉鍙楀奖鍝嶃€? */
async function makeGame(mapName: "extraction" | "main"): Promise<Game> {
    const game = new Game(
        `ammo-${mapName}`,
        { mapName, teamMode: TeamMode.Solo },
        () => {},
        () => {},
    );
    await game.init();
    return game;
}

function ammoSpawnedWithGun(
    game: Game,
    gunType: string,
    ammoType: string,
): number {
    const start = game.lootBarn.loots.length;
    game.lootBarn.addLoot(gunType, { x: 200, y: 200 }, 0, 1);
    let total = 0;
    for (let i = start; i < game.lootBarn.loots.length; i++) {
        const loot = game.lootBarn.loots[i];
        if (loot.type === ammoType) total += loot.count;
    }
    return total;
}

void (async () => {
    const cases: Array<{ gun: string; expectedMult: number }> = [
        { gun: "ak47", expectedMult: 0.5 }, // 762mm 鏅€氬脊鑽?-> 梅10
        { gun: "deagle", expectedMult: 0.5 }, // 50AE 楂樼骇寮硅嵂 -> 梅5
        { gun: "awc", expectedMult: 0.5 }, // 308sub (.338) 楂樼骇寮硅嵂 -> 梅5
    ];
    for (const c of cases) {
        const def = (GunDefs as Record<string, { ammo?: string; ammoSpawnCount?: number }>)[
            c.gun
        ];
        assert(def && def.ammo, `gun def for ${c.gun}`);
        const ammoType = def.ammo!;
        const spawnCount = Math.max(1, Math.floor(Number(def.ammoSpawnCount) || 0));
        const expectedExt = Math.max(1, Math.floor(spawnCount * c.expectedMult));

        const mainGame = await makeGame("main");
        const extGame = await makeGame("extraction");
        try {
            const mainAmmo = ammoSpawnedWithGun(mainGame, c.gun, ammoType);
            const extAmmo = ammoSpawnedWithGun(extGame, c.gun, ammoType);
            assert.equal(
                mainAmmo,
                spawnCount,
                `${c.gun}: other modes must keep full weapon-attached ammo (${mainAmmo} vs ${spawnCount})`,
            );
            assert.equal(
                extAmmo,
                expectedExt,
                `${c.gun}: extraction must reduce weapon-attached ammo (${extAmmo} vs expected ${expectedExt})`,
            );
        } finally {
            mainGame.stop();
            extGame.stop();
        }
    }
    console.log(
        "Extraction ammo quantity smoke test passed: weapon-attached ammo halved (x0.5) in extraction, full in other modes.",
    );
})();
