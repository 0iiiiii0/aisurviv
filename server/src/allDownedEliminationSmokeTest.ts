import assert from "assert/strict";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import * as net from "../../shared/net/net.ts";
import { Game } from "./game/game.ts";

function join(game: Game, socketId: string, token: string, name: string, teamId: number) {
    game.addJoinToken(token, true, 1, 60_000, false, true, [teamId]);
    const msg = new net.JoinMsg();
    msg.protocol = GameConfig.protocolVersion;
    msg.matchPriv = token;
    msg.name = name;
    const player = game.playerBarn.addPlayer(socketId, msg);
    assert(player);
    return player;
}

function hurt(source: ReturnType<typeof join>, target: ReturnType<typeof join>, amount: number) {
    target.damage({
        amount,
        damageType: GameConfig.DamageType.Player,
        dir: { x: 1, y: 0 },
        source,
        gameSourceType: "",
    });
}

/** Expire the post-down damage buffer, then finish the downed target. */
function finish(source: ReturnType<typeof join>, target: ReturnType<typeof join>) {
    target.downedDamageTicker = 0;
    hurt(source, target, 1000);
}

/** No self-revive: an all-downed team loses immediately (no slow bleed-out wait). */
async function runFactionWithoutSelfRevive(): Promise<void> {
    const game = new Game(
        "all-downed-no-selfrevive",
        { mapName: "faction", teamMode: TeamMode.Squad },
        () => {},
        () => {},
    );
    await game.init();
    const x = join(game, "x", "tx", "X", 1);
    const y = join(game, "y", "ty", "Y", 1);
    const c = join(game, "c", "tc", "C", 2);

    hurt(c, x, 1000);
    assert.equal(x.downed, true, "X should be downed first");
    hurt(c, y, 1000);

    // The whole downed team must be eliminated immediately.
    assert.equal(x.dead, true, "downed teammate must be eliminated with the team");
    assert.equal(y.dead, true, "the last standing member must be eliminated when the team is all-downed");
    assert.equal(game.modeManager.aliveCount(), 1, "only the surviving enemy team remains");
    assert.equal(game.over, true, "the game must end right after the last survivors are downed");
}

/**
 * With self-revive, downed survivors keep their comeback: the team is only
 * eliminated after every self-revive member has actually died.
 */
async function runFactionWithSelfRevive(): Promise<void> {
    const game = new Game(
        "all-downed-with-selfrevive",
        { mapName: "faction", teamMode: TeamMode.Squad },
        () => {},
        () => {},
    );
    await game.init();
    const x = join(game, "x", "tx", "X", 1);
    const y = join(game, "y", "ty", "Y", 1);
    const c = join(game, "c", "tc", "C", 2);
    x.addPerk("self_revive", false);
    y.addPerk("self_revive", false);

    hurt(c, x, 1000);
    assert.equal(x.downed, true, "X should be downed first");
    hurt(c, y, 1000);

    // Y's down does not eliminate the team: X can still self-revive.
    assert.equal(x.dead, false, "self-revive teammate must not be eliminated yet");
    assert.equal(y.dead, false, "last standing member must be downed, not killed, while self-revive is possible");
    assert.equal(x.downed, true);
    assert.equal(y.downed, true);
    assert.equal(game.modeManager.aliveCount(), 2, "both factions still have living members");
    assert.equal(game.over, false, "the game must keep running while self-revive is possible");

    // X is finished while downed: Y still has self-revive, so the team survives.
    finish(c, x);
    assert.equal(x.dead, true, "finished self-revive member dies");
    assert.equal(y.dead, false, "Y must not be dragged down while Y can self-revive");

    // Y is finished while downed: no self-revive member remains -> elimination.
    finish(c, y);
    assert.equal(y.dead, true, "the last downed member must be eliminated once no self-revive remains");
    assert.equal(game.modeManager.aliveCount(), 1, "only the surviving enemy team remains");
    assert.equal(game.over, true, "the game must end after the last self-revive member dies");
}

async function runDuo(): Promise<void> {
    const game = new Game(
        "all-downed-duo",
        { mapName: "main", teamMode: TeamMode.Duo },
        () => {},
        () => {},
    );
    await game.init();
    // Force X and Y into one duo group and C into another by pre-creating the
    // groups and pointing the join tokens at them.
    const g1 = game.playerBarn.addGroup(true);
    game.playerBarn.groupsByHash.set("duo-ab", g1);
    const g2 = game.playerBarn.addGroup(true);
    game.playerBarn.groupsByHash.set("duo-c", g2);
    const joinGrouped = (
        socketId: string,
        token: string,
        name: string,
        hash: string,
    ) => {
        game.addJoinToken(token, true, 1, 60_000, false, true, [1]);
        const data = game.joinTokens.get(token);
        assert(data);
        data.groupHashToJoin = hash;
        const msg = new net.JoinMsg();
        msg.protocol = GameConfig.protocolVersion;
        msg.matchPriv = token;
        msg.name = name;
        const player = game.playerBarn.addPlayer(socketId, msg);
        assert(player);
        return player;
    };
    const x = joinGrouped("x", "tx", "X", "duo-ab");
    const y = joinGrouped("y", "ty", "Y", "duo-ab");
    const c = joinGrouped("c", "tc", "C", "duo-c");
    assert.equal(x.groupId, y.groupId, "X and Y must be teammates in duo");
    assert.notEqual(x.groupId, c.groupId, "C must be on the opposing duo");
    x.addPerk("self_revive", false);
    y.addPerk("self_revive", false);
    hurt(c, x, 1000);
    hurt(c, y, 1000);

    // Duo mirrors the faction rule: self-revive keeps the duo alive.
    assert.equal(x.dead, false, "duo self-revive member must survive the all-down");
    assert.equal(y.dead, false, "duo last standing member must be downed, not eliminated");
    assert.equal(game.modeManager.aliveCount(), 2, "both duos remain alive");
    assert.equal(game.over, false, "duo must not end while self-revive is possible");

    // Finish both downed members: the duo is eliminated.
    finish(c, x);
    assert.equal(x.dead, true, "duo member must die when finished");
    assert.equal(y.dead, false, "duo survives while the last self-revive member is still alive");
    finish(c, y);
    assert.equal(y.dead, true, "duo must be eliminated after the last self-revive member dies");
    assert.equal(game.modeManager.aliveCount(), 1, "only the enemy duo remains");
    assert.equal(game.over, true, "duo game must end after elimination");
}

async function main(): Promise<void> {
    await runFactionWithoutSelfRevive();
    await runFactionWithSelfRevive();
    await runDuo();
    console.log("All-downed elimination smoke test passed: teams without self-revive lose immediately, while self-revive survivors keep their last-stand comeback.");
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});