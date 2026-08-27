import assert from "node:assert/strict";
import { GameObjectDefs } from "../../shared/defs/gameObjectDefs.ts";
import type { GunDef } from "../../shared/defs/gameObjects/gunDefs.ts";
import type { MeleeDef } from "../../shared/defs/gameObjects/meleeDefs.ts";
import type { ThrowableDef } from "../../shared/defs/gameObjects/throwableDefs.ts";
import { GameConfig } from "../../shared/gameConfig.ts";
import { Player } from "./game/objects/player.ts";

type WeaponDef = GunDef | MeleeDef | ThrowableDef;

function makePlayer(sourceWeapon: string, rarePotato = false) {
    const sourceDef = GameObjectDefs[sourceWeapon] as WeaponDef;
    const slot =
        sourceDef.type === "gun"
            ? GameConfig.WeaponSlot.Primary
            : sourceDef.type === "melee"
              ? GameConfig.WeaponSlot.Melee
              : GameConfig.WeaponSlot.Throwable;
    const weapons = Array.from({ length: GameConfig.WeaponSlot.Count }, (_, index) => ({
        type: index === GameConfig.WeaponSlot.Melee ? "fists" : "",
        ammo: 0,
        cooldown: 0,
        recoilTime: 0,
    }));
    weapons[slot].type = sourceWeapon;

    const emotes: string[] = [];
    const player = {
        __id: 7,
        pos: { x: 10, y: 20 },
        dead: false,
        role: "",
        curWeapIdx: slot,
        activeWeapon: sourceWeapon,
        weapons,
        backpack: "backpack00",
        inventory: Object.fromEntries(Object.keys(GameConfig.bagSizes).map((key) => [key, 0])),
        inventoryDirty: false,
        shotSlowdownTimer: 1,
        hasPerk: (perk: string) => rarePotato && perk === "rare_potato",
        getGearLevel: () => 0,
        isReloading: () => false,
        cancelAction: () => undefined,
        setDirty: () => undefined,
        game: {
            playerBarn: {
                addEmote: (
                    _playerId: number,
                    _pos: unknown,
                    type: string,
                    _isPing: boolean,
                    itemType: string,
                ) => emotes.push(`${type}:${itemType}`),
            },
        },
        weaponManager: {
            cookingThrowable: false,
            getTrueAmmoStats: (def: GunDef) => ({
                trueMaxClip: def.maxClip,
                trueMaxReload: def.maxReload,
                trueMaxReloadAlt: def.maxReloadAlt,
            }),
            setWeapon: (index: number, type: string, ammo: number) => {
                weapons[index].type = type;
                weapons[index].ammo = ammo;
            },
        },
    };

    return { player, slot, emotes };
}

function runSwap(sourceWeapon: string, rarePotato = false) {
    const context = makePlayer(sourceWeapon, rarePotato);
    Player.prototype.randomWeaponSwap.call(context.player, {
        damageType: GameConfig.DamageType.Player,
        dir: { x: 1, y: 0 },
        gameSourceType: sourceWeapon,
    });
    return context;
}

for (let i = 0; i < 40; i++) {
    const { player, slot, emotes } = runSwap("m9");
    const result = GameObjectDefs[player.weapons[slot].type] as WeaponDef;
    assert.equal(result.type, "gun");
    assert.equal(result.noPotatoSwap, undefined);
    assert.ok(player.weapons[slot].ammo > 0);
    assert.equal(emotes.length, 1);
    assert.ok(emotes[0].startsWith("emote_loot:"));
}

for (let i = 0; i < 40; i++) {
    const { player, slot } = runSwap("fists", true);
    const result = GameObjectDefs[player.weapons[slot].type] as WeaponDef;
    assert.equal(result.type, "melee");
    assert.equal(result.quality, 1);
    assert.notEqual(result.noPotatoSwap, true);
}

for (let i = 0; i < 40; i++) {
    const { player, slot } = runSwap("frag");
    const result = GameObjectDefs[player.weapons[slot].type] as WeaponDef;
    assert.equal(result.type, "throwable");
    assert.notEqual(result.noPotatoSwap, true);
}

const protectedWeapon = runSwap("potato_cannon");
assert.equal(
    protectedWeapon.player.weapons[protectedWeapon.slot].type,
    "potato_cannon",
);
assert.equal(protectedWeapon.emotes.length, 0);

console.log("Potato weapon rotation smoke test passed.");
