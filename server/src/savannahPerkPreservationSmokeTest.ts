import assert from "assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Game } from "./game/game.ts";

function join(game: Game, socketId: string, token: string, name: string) {
    game.addJoinToken(token, true, 1, 60_000, false, true, [1]);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = name;
    const player = game.playerBarn.addPlayer(socketId, msg);
    assert(player);
    return player;
}

async function main(): Promise<void> {
    const game = new Game(
        "savannah-perk-preservation",
        { mapName: "savannah", teamMode: TeamMode.Solo },
        () => {},
        () => {},
    );
    await game.init();
    assert.equal(game.map.mapDef.gameMode.sniperMode, true);

    // 1. The Savannah kill-streak buff (the_hunted) must NOT wipe loot perks
    //    such as split bullets.
    const hunted = join(game, "hunted-socket", "hunted-token", "Hunted");
    hunted.addPerk("splinter", true); // loot split bullets (droppable slot)
    hunted.promoteToRole("the_hunted");

    assert.equal(
        hunted.hasPerk("splinter"),
        true,
        "loot split bullets must survive the Savannah kill-streak buff",
    );
    assert.equal(hunted.hasPerk("hunted"), true, "kill leader must receive the hunted buff");
    assert.equal(
        hunted.perks.find((perk) => perk.type === "hunted")?.isFromRole,
        true,
        "hunted buff must be marked as role-origin",
    );

    // 2. When the kill leader is replaced, only role-origin perks go away.
    const nextLeader = join(game, "next-socket", "next-token", "Next");
    nextLeader.addPerk("splinter", true);
    nextLeader.addPerk("takedown", true);
    nextLeader.promoteToRole("the_hunted");
    hunted.removeRole();

    assert.equal(hunted.hasPerk("hunted"), false, "replaced leader must lose the hunted buff");
    assert.equal(
        hunted.hasPerk("splinter"),
        true,
        "replaced leader must keep loot split bullets",
    );

    // 3. Role perks that collide with loot perks are re-granted as role
    //    origin; unrelated loot perks are preserved.
    const lastMan = join(game, "last-socket", "last-token", "Last");
    lastMan.addPerk("splinter", true); // also granted by last_man
    lastMan.addPerk("takedown", true); // unrelated loot perk
    lastMan.promoteToRole("last_man");

    assert.equal(lastMan.hasPerk("takedown"), true, "unrelated loot perk must survive");
    assert.equal(lastMan.hasPerk("splinter"), true, "last_man re-grants split bullets");
    assert.equal(
        lastMan.perks.find((perk) => perk.type === "splinter")?.isFromRole,
        true,
        "colliding split bullets become role-origin after promotion",
    );

    // 4. removePerk with a missing type must not remove the last perk.
    const guard = join(game, "guard-socket", "guard-token", "Guard");
    guard.addPerk("takedown", true);
    guard.removePerk("does_not_exist");
    assert.equal(guard.hasPerk("takedown"), true, "missing-perk removal must not delete an unrelated perk");

    // 5. removeRole() is a no-op when no role is set.
    guard.removeRole();
    assert.equal(guard.role, "");
    assert.equal(guard.hasPerk("takedown"), true, "loot perk stays when no role is present");

    console.log("Savannah perk preservation smoke test passed: kill-streak buff keeps loot perks.");
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});
