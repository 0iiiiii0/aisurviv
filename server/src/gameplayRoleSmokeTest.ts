import assert from "assert/strict";
import { GameObjectDefs } from "../../shared/defs/gameObjectDefs.ts";
import { MapObjectDefs } from "../../shared/defs/mapObjectDefs.ts";
import type { ObstacleDef } from "../../shared/defs/mapObjectsTyping.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { ObjectType } from "../../shared/net/objectSerializeFns.ts";
import { collider } from "../../shared/utils/collider.ts";
import { Game } from "./game/game.ts";
import type { Obstacle } from "./game/objects/obstacle.ts";
import { getStrobeAirstrikeOffsets } from "./game/objects/projectile.ts";

function join(game: Game, socketId: string, token: string, name: string, teamId: number) {
    game.addJoinToken(token, true, teamId, 60_000, false, true, [teamId]);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = name;
    const player = game.playerBarn.addPlayer(socketId, msg);
    assert(player);
    return player;
}

function eliminate(source: ReturnType<typeof join>, target: ReturnType<typeof join>) {
    target.damage({
        amount: 1000,
        damageType: GameConfig.DamageType.Player,
        dir: { x: 1, y: 0 },
        source,
        gameSourceType: source.activeWeapon,
    });
}

async function main(): Promise<void> {
    const game = new Game(
        "gameplay-role-smoke",
        { mapName: "faction", teamMode: TeamMode.Squad },
        () => {},
        () => {},
    );
    await game.init();

    const leader = join(game, "leader-socket", "leader-token", "Leader", 1);
    leader.boost = 0;
    leader.promoteToRole("leader");
    assert.equal(leader.boost, 100, "Leadership must start with maximum adrenaline");
    assert.equal(leader.scale, 1.25, "Leadership must increase player size by 25%");
    leader.update(4);
    assert.equal(leader.boost, 100, "Leadership adrenaline must not decay");
    assert.equal(leader.hasRoleHelmet, true, "Commander helmet must remain role-locked");

    const scout = join(game, "scout-socket", "scout-token", "Scout", 2);
    scout.promoteToRole("scout");
    assert.equal(scout.scale, 0.75, "Small Arms must reduce player size by 25%");
    assert.equal(
        scout.hasRoleHelmet,
        false,
        "Cobalt classes use a visor and must still be able to replace ordinary helmets",
    );

    const originalIsOnWater = game.map.isOnWater.bind(game.map);
    game.map.isOnWater = () => true;
    scout.recalculateSpeed();
    assert.equal(
        scout.speed,
        GameConfig.player.moveSpeed +
            1 +
            (scout.boost >= 50 ? GameConfig.player.boostMoveSpeed : 0) +
            2,
        "Small Arms and One With Nature speed bonuses must both apply in water",
    );
    game.map.isOnWater = originalIsOnWater;

    const demo = join(game, "demo-socket", "demo-token", "Demo", 2);
    demo.promoteToRole("demo");
    assert.equal(demo.scale, 1.1, "Flak Jacket must increase player size by 10%");
    demo.update(0.01);
    assert.equal(
        demo.inventory.frag,
        GameConfig.bagSizes.frag[demo.getGearLevel(demo.backpack)],
        "Fabricate must immediately fill the player's Frag Grenade capacity",
    );
    assert.equal(
        demo.weapons[GameConfig.WeaponSlot.Throwable].type,
        "frag",
        "Fabricated Frag Grenades must be usable when the throwable slot was empty",
    );
    demo.inventory.frag = 0;
    demo.update(11.9);
    assert.equal(demo.inventory.frag, 0, "Fabricate must not refill before 12 seconds");
    demo.update(0.11);
    assert.equal(
        demo.inventory.frag,
        GameConfig.bagSizes.frag[demo.getGearLevel(demo.backpack)],
        "Fabricate must refill Frag Grenades every 12 seconds",
    );

    const woodsKing = join(game, "woods-socket", "woods-token", "Woods King", 1);
    woodsKing.health = 50;
    woodsKing.promoteToRole("woods_king");
    assert.equal(woodsKing.scale, 1.25, "Gift of the Woods must increase size by 25%");
    woodsKing.update(2);
    assert.equal(woodsKing.health, 52, "Gift of the Woods must restore one health per second");
    game.explosionBarn.addExplosion(
        "explosion_rounds",
        { ...woodsKing.pos },
        woodsKing.layer,
        "",
        "",
        GameConfig.DamageType.Player,
        scout,
    );
    game.explosionBarn.update();
    assert.equal(
        woodsKing.hasteType,
        GameConfig.HasteType.Windwalk,
        "An enemy explosion within five units must activate Windwalk",
    );
    woodsKing.hasteType = GameConfig.HasteType.None;
    game.explosionBarn.addExplosion(
        "explosion_rounds",
        { ...woodsKing.pos },
        woodsKing.layer,
        "",
        "",
        GameConfig.DamageType.Player,
        leader,
    );
    game.explosionBarn.update();
    assert.equal(
        woodsKing.hasteType,
        GameConfig.HasteType.None,
        "A friendly explosion must not activate Windwalk",
    );

    const tree = game.objectRegister.objects.find(
        (obj): obj is Obstacle =>
            obj?.__type === ObjectType.Obstacle &&
            Boolean((MapObjectDefs[obj.type] as ObstacleDef).isTree) &&
            !obj.dead,
    );
    assert(tree, "Faction map must contain a tree for collision regression coverage");

    const treeBounds = collider.toAabb(tree.collider);
    scout.pos.x = treeBounds.min.x - scout.rad - 0.05;
    scout.pos.y = tree.pos.y;
    scout.collider.pos = scout.pos;
    scout.moveRight = true;
    scout.update(0.5);
    assert(
        scout.pos.x > tree.pos.x,
        "One With Nature must allow the scout to move through tree collision",
    );
    const lootBeforeMasterScavenger = game.lootBarn.loots.length;
    for (const item of game.map.mapDef.lootTable.tier_scavenger_adv) {
        assert(GameObjectDefs[item.name], `Master Scavenger contains invalid item ${item.name}`);
    }
    scout.addPerk("scavenger_adv");
    tree.kill({
        damageType: GameConfig.DamageType.Player,
        dir: { x: 1, y: 0 },
        source: scout,
        gameSourceType: scout.activeWeapon,
    });
    assert(
        game.lootBarn.loots.length > lootBeforeMasterScavenger,
        "Master Scavenger must add one item from its high-quality loot tier",
    );

    let savannah: Game | undefined;
    for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = new Game(
            `savannah-role-smoke-${attempt}`,
            { mapName: "savannah", teamMode: TeamMode.Solo },
            () => {},
            () => {},
        );
        await candidate.init();
        savannah ??= candidate;
    }
    assert(savannah);
    const hunter = join(savannah, "hunter", "hunter-token", "Hunter", 1);
    const firstVictim = join(savannah, "victim-1", "victim-token-1", "Victim 1", 2);
    const secondVictim = join(savannah, "victim-2", "victim-token-2", "Victim 2", 3);
    const thirdVictim = join(savannah, "victim-3", "victim-token-3", "Victim 3", 4);
    eliminate(hunter, firstVictim);
    eliminate(hunter, secondVictim);
    assert.equal(
        savannah.playerBarn.killLeader,
        undefined,
        "Savannah must not appoint The Hunted before three kills",
    );
    eliminate(hunter, thirdVictim);
    assert.equal(savannah.playerBarn.killLeader, hunter);
    assert.equal(hunter.role, "the_hunted");
    assert.equal(hunter.hasPerk("hunted"), true);

    const challenger = join(savannah, "challenger", "challenger-token", "Challenger", 5);
    const fourthVictim = join(savannah, "victim-4", "victim-token-4", "Victim 4", 6);
    challenger.kills = 3;
    eliminate(challenger, fourthVictim);
    assert.equal(savannah.playerBarn.killLeader, challenger);
    assert.equal(challenger.role, "the_hunted");
    assert.equal(challenger.hasPerk("hunted"), true);
    assert.equal(hunter.role, "");
    assert.equal(hunter.hasPerk("hunted"), false);

    assert.deepEqual(getStrobeAirstrikeOffsets(false), [0, 5, -5]);
    assert.deepEqual(
        getStrobeAirstrikeOffsets(true),
        [0, 5, -5, 10, -10],
        "the real Broken Arrow perk must add exactly two airstrike passes",
    );

    challenger.addPerk("bonus_9mm");
    challenger.weaponManager.setWeapon(GameConfig.WeaponSlot.Primary, "m9", 15);
    challenger.weaponManager.setCurWeapIndex(GameConfig.WeaponSlot.Primary);
    challenger.weaponManager.fireWeapon(false);
    const overpressureBullet = savannah.bulletBarn.bullets.at(-1);
    assert(overpressureBullet);
    assert.equal(
        overpressureBullet.bulletType,
        "bullet_m9_bonus",
        "9mm Overpressure must use the faster, longer-range bonus projectile",
    );

    console.log(
        "Gameplay role smoke test passed: faction, Woods, Cobalt, and Savannah role mechanics.",
    );
}

void main();
