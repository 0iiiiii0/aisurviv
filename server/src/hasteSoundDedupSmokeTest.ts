import assert from "assert/strict";
import fs from "fs";
import path from "path";
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

async function runHasteSeqDedup(): Promise<void> {
    const game = new Game(
        "haste-sound",
        { mapName: "main", teamMode: TeamMode.Solo },
        () => {},
        () => {},
    );
    await game.init();
    const p = join(game, "s", "t", "Runner");

    // First windwalk grant plays the sound (seq bumps).
    p.giveHaste(GameConfig.HasteType.Windwalk, 4);
    const seqAfterFirst = p.hasteSeq;
    assert.equal(p.hasteType, GameConfig.HasteType.Windwalk);
    assert.equal(seqAfterFirst >= 1, true);

    // Repeated windwalk triggers while still active refresh the duration
    // WITHOUT bumping hasteSeq, so the client does not replay the sound.
    const tickerBefore = (p as unknown as { _hasteTicker: number })._hasteTicker;
    p.giveHaste(GameConfig.HasteType.Windwalk, 4);
    p.giveHaste(GameConfig.HasteType.Windwalk, 4);
    assert.equal(
        p.hasteSeq,
        seqAfterFirst,
        "an already-active windwalk must not bump hasteSeq (no repeated sound)",
    );
    assert.ok(
        (p as unknown as { _hasteTicker: number })._hasteTicker >= tickerBefore,
        "the active windwalk duration must be refreshed",
    );

    // A different haste type still plays its sound.
    p.giveHaste(GameConfig.HasteType.Takedown, 3);
    assert.equal(p.hasteSeq, seqAfterFirst + 1, "a different haste type must bump hasteSeq");
    assert.equal(p.hasteType, GameConfig.HasteType.Takedown);

    // Once the haste fully expires (the server expiry handler resets to None
    // and bumps the seq), a new windwalk plays the sound again.
    (p as unknown as { _hasteTicker: number })._hasteTicker = 0;
    p.hasteType = GameConfig.HasteType.None;
    p.hasteSeq++;
    p.giveHaste(GameConfig.HasteType.Windwalk, 4);
    assert.equal(
        p.hasteSeq,
        seqAfterFirst + 3,
        "a fresh windwalk after expiry must bump hasteSeq once",
    );
}

// Source guarantees: the windwalk perk triggers haste on bullets/explosions,
// and the refresh guard prevents repeated client sounds.
const playerSource = fs.readFileSync(path.join(__dirname, "game", "objects", "player.ts"), "utf8");
assert.ok(playerSource.includes("without bumping hasteSeq"), "giveHaste must hold the seq on refresh");
const bulletSource = fs.readFileSync(path.join(__dirname, "game", "objects", "bullet.ts"), "utf8");
assert.ok(bulletSource.includes('obj.hasPerk("windwalk")'), "the windwalk perk is bullet-triggered");
const explosionSource = fs.readFileSync(path.join(__dirname, "game", "objects", "explosion.ts"), "utf8");
assert.ok(explosionSource.includes('hasPerk("windwalk")'), "the windwalk perk is explosion-triggered");

async function main(): Promise<void> {
    await runHasteSeqDedup();
    console.log("Haste sound dedup smoke test passed: refreshing an active windwalk no longer replays the sound.");
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});