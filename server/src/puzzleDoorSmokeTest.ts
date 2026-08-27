import assert from "assert/strict";
import fs from "fs";
import path from "path";
import { BitStream } from "../../shared/net/net.ts";
import { ObjectSerializeFns, ObjectType } from "../../shared/net/objectSerializeFns.ts";
import { v2 } from "../../shared/utils/v2.ts";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { Game } from "./game/game.ts";
import { Building } from "./game/objects/building.ts";
import { Obstacle } from "./game/objects/obstacle.ts";
import { inferPuzzleOrder } from "./bot/integratedLogicSpec.ts";

// 1) Password-door order inference (the new bot search logic).
{
    assert.deepEqual(
        inferPuzzleOrder(["egg", "hydra", "storm", "conch", "crossing", "hatchet"]),
        ["egg", "hydra", "storm", "conch", "crossing", "hatchet"],
        "Eye bunker order must be recognized",
    );
    assert.deepEqual(
        inferPuzzleOrder(["ichi", "shi", "ni", "san"]),
        ["ichi", "ni", "san", "shi"],
        "Chrysanthemum bunker order must be recognized regardless of input order",
    );
    assert.deepEqual(
        inferPuzzleOrder(["red", "blue", "green", "orange", "yellow", "indigo", "violet"]),
        ["red", "orange", "yellow", "green", "blue", "indigo", "violet"],
        "Saloon order must be recognized",
    );
    assert.deepEqual(
        inferPuzzleOrder(["1", "2", "3", "4"]),
        ["1", "2", "3", "4"],
        "club_01 (4-piece) must win over club_02 when all four pieces exist",
    );
    assert.deepEqual(
        inferPuzzleOrder(["1"]),
        ["1"],
        "a lone 1 piece is the bathhouse club_02",
    );
    assert.equal(
        inferPuzzleOrder(["egg", "hydra"]),
        null,
        "a partial order must not be attempted",
    );
    assert.equal(
        inferPuzzleOrder(["swine", "caduceus"]),
        null,
        "decoy pieces alone must not trigger a puzzle",
    );
}

// 2) Wire round-trip: the bot must receive each puzzle piece's label.
{
    const source = {
        healthT: 1,
        type: "switch_01",
        layer: 0,
        dead: false,
        isDoor: false,
        isButton: true,
        button: { onOff: false, canUse: true, seq: 3 },
        isPuzzlePiece: true,
        parentBuildingId: 777,
        puzzlePiece: "ichi",
        isSkin: false,
        skinPlayerId: 0,
    } as never;
    const stream = new BitStream(new ArrayBuffer(256));
    ObjectSerializeFns[ObjectType.Obstacle].serializeFull(stream, source);
    stream.index = 0;
    const restored = {} as Record<string, unknown>;
    ObjectSerializeFns[ObjectType.Obstacle].deserializeFull(stream, restored as never);
    assert.equal(restored.puzzlePiece, "ichi", "puzzlePiece must survive the wire");
    assert.equal(restored.parentBuildingId, 777, "parentBuildingId must survive the wire");
    assert.equal(restored.isPuzzlePiece, true, "puzzle piece flag must survive the wire");
}

// 3) Server puzzle mechanics: pressing the exact order opens the vault door.
async function runServerPuzzle(): Promise<void> {
    const game = new Game(
        "puzzle-door",
        { mapName: "main", teamMode: TeamMode.Solo },
        () => {},
        () => {},
    );
    await game.init();
    const building = new Building(
        game,
        "bunker_eye_sublevel_01",
        v2.create(500, 500),
        0,
        0,
    );
    game.objectRegister.register(building);
    const pieces: Obstacle[] = [];
    for (let i = 0; i < 6; i++) {
        const piece = new Obstacle(
            game,
            v2.create(500 + i, 520),
            "control_panel_02b",
            0,
            0,
            1,
            building.__id,
            ["egg", "hydra", "storm", "conch", "crossing", "hatchet"][i],
        );
        game.objectRegister.register(piece);
        building.childObjects.push(piece);
        pieces.push(piece);
    }
    const door = new Obstacle(game, v2.create(515, 500), "vault_door_eye", 0, 0, 1, building.__id);
    game.objectRegister.register(door);
    building.childObjects.push(door);
    assert.equal(door.door.open, false, "vault door starts closed");
    assert.equal(door.door.canUse, false, "vault door cannot be opened directly");

    for (const piece of pieces) {
        building.puzzlePieceToggled(piece);
    }
    assert.equal(building.puzzleSolved, true, "the password sequence must solve the puzzle");
    // The door opens after completeUseDelay (5.25s for the Eye bunker).
    const deadline = Date.now() + 8000;
    while (!door.door.open && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.equal(door.door.open, true, "the vault door must open after the correct sequence");
}

// 4) Source guarantees: the smart bot owns a puzzle solver and armed button doors.
const smartBotSource = fs.readFileSync(path.join(__dirname, "smartBot.ts"), "utf8") + "\n" + fs.readFileSync(path.join(__dirname, "bot", "smartBotSupport.ts"), "utf8");
assert.match(smartBotSource, /private continuePuzzle\(/, "bot must drive the puzzle sequence");
assert.match(smartBotSource, /private choosePuzzleTarget\(/, "bot must select puzzle buildings");
assert.match(smartBotSource, /inferPuzzleOrder\(/, "bot must use the password-order table");
assert.match(smartBotSource, /chooseVaultPanel\(myPos, enemyDistance, timestamp, true\)/, "armed bots must open button doors");
assert.match(smartBotSource, /kind: "puzzle"/, "the puzzle intent must compete in the search phase");
const configSource = fs.readFileSync(path.join(__dirname, "..", "..", "shared", "gameConfig.ts"), "utf8");
    assert.match(configSource, /protocolVersion: 89/, "wire protocol must be bumped for the puzzle label");

async function main(): Promise<void> {
    await runServerPuzzle();
    console.log("Puzzle/button-door smoke test passed: password sequences are inferred, transmitted and solved.");
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});
