import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { GameConfig, TeamMode } from "../../shared/gameConfig.ts";
import { BitStream } from "../../shared/net/net.ts";
import { JoinedMsg } from "../../shared/net/joinedMsg.ts";
import { AimTrainingStatsMsg } from "../../shared/net/aimTrainingStatsMsg.ts";

const roundTrip = <T extends { serialize(stream: BitStream): void; deserialize(stream: BitStream): void }>(
    input: T,
    output: T,
): T => {
    const buffer = new ArrayBuffer(256);
    const writer = new BitStream(buffer);
    input.serialize(writer);
    const reader = new BitStream(buffer);
    output.deserialize(reader);
    return output;
};

const joined = new JoinedMsg();
joined.teamMode = TeamMode.Solo;
joined.playerId = 42;
joined.started = true;
joined.spectatorOnly = false;
joined.trainingTarget = false;
joined.emotes = [];
const decodedJoined = roundTrip(joined, new JoinedMsg());
assert.equal(decodedJoined.playerId, 42);
assert.equal(decodedJoined.spectatorOnly, false);
assert.equal(decodedJoined.trainingTarget, false);

const observer = new JoinedMsg();
observer.teamMode = TeamMode.Solo;
observer.playerId = 43;
observer.spectatorOnly = true;
observer.trainingTarget = false;
observer.emotes = [];
assert.equal(roundTrip(observer, new JoinedMsg()).spectatorOnly, true);

const target = new JoinedMsg();
target.teamMode = TeamMode.Solo;
target.playerId = 44;
target.spectatorOnly = false;
target.trainingTarget = true;
target.emotes = [];
assert.equal(roundTrip(target, new JoinedMsg()).trainingTarget, true);

const stats = new AimTrainingStatsMsg();
stats.shotsFired = 11;
stats.hits = 7;
stats.damageDealt = 123.4;
stats.distance = 60;
stats.targetBoost = 75;
stats.speedBonus = 8.5;
stats.infiniteMagazine = true;
stats.targetReady = false;
const reconnecting = roundTrip(stats, new AimTrainingStatsMsg());
assert.equal(reconnecting.targetReady, false);
assert.equal(reconnecting.infiniteMagazine, true);
stats.targetReady = true;
assert.equal(roundTrip(stats, new AimTrainingStatsMsg()).targetReady, true);

assert.equal(GameConfig.protocolVersion, 1024, "network shape changes must reject stale clients");

const projectRoot = path.resolve(import.meta.dirname, "../..");
const clientGame = fs.readFileSync(path.join(projectRoot, "client/src/game.ts"), "utf8");
const clientUi2 = fs.readFileSync(path.join(projectRoot, "client/src/ui/ui2.ts"), "utf8");
const clientHtml = fs.readFileSync(path.join(projectRoot, "client/index.html"), "utf8");
const gameServer = fs.readFileSync(path.join(projectRoot, "server/src/gameServer.ts"), "utf8");
const playerSource = fs.readFileSync(path.join(projectRoot, "server/src/game/objects/player.ts"), "utf8");
const clientSource = fs.readFileSync(path.join(projectRoot, "server/src/game/client.ts"), "utf8");

assert.match(clientGame, /aimTrainingHuman[\s\S]*this\.m_activeId = this\.m_localId/);
assert.match(
    clientGame,
    /import \$ from "jquery";/,
    "aim-training HUD updates must import jQuery instead of relying on a missing browser global",
);
assert.match(clientGame, /this\.m_map\.mapName !== "aim_training"[\s\S]*this\.updateArenaRoundUi/);
assert.match(
    clientUi2,
    /setEventListener\("touchstart", item\.div,[\s\S]*?e\.stopPropagation\(\)[\s\S]*?item\.actionQueued = true/,
    "a mobile weapon-slot touch must be owned by the HUD instead of leaking into movement/aim input",
);
assert.match(
    clientUi2,
    /setEventListener\("touchend", item\.div, \(e\)[\s\S]*?e\.stopPropagation\(\);[\s\S]*?e\.cancelable[\s\S]*?e\.preventDefault\(\);[\s\S]*?item\.action == "use"[\s\S]*?this\.pushAction\(item\)/,
    "a short mobile tap must stay in the HUD, suppress the ghost mouse event, and enqueue one use action",
);
assert.match(
    clientHtml,
    /id=["']ui-weapon-container["']\s+data-game-input-blocker/,
    "the native weapon HUD must opt out of gameplay/controller touch capture",
);
assert.match(
    clientGame,
    /e\.type == "weapon"[\s\S]*?\[WeaponSlot\.Primary\]: Input\.EquipPrimary[\s\S]*?\[WeaponSlot\.Secondary\]: Input\.EquipSecondary[\s\S]*?inputMsg\.addInput\(input\)/,
    "weapon HUD actions must become authoritative primary/secondary equip inputs",
);
assert.match(clientGame, /移动标靶正在自动重连/);
assert.doesNotMatch(gameServer, /launchAimTrainingTarget/);
assert.doesNotMatch(gameServer, /superviseAimTrainingTarget/);
assert.match(playerSource, /spawnInternalAimTrainingTarget/);
assert.match(playerSource, /internalTrainingTarget/);
assert.match(clientSource, /trainingStats\.targetReady/);
assert.match(clientSource, /MsgType\.SpectatorOverlay/);
assert.match(clientSource, /joinedMsg\.spectatorOnly = this\.player\?\.spectatorOnly/);
assert.match(
    clientSource,
    /Aim-training humans always own their local player camera[\s\S]*?this\.spectating = undefined/,
);

console.log(
    "V42 aim-training spectator guard smoke test passed: connection roles are explicit, stale protocol clients are rejected, training humans retain their local camera, and the moving target is server-owned.",
);
