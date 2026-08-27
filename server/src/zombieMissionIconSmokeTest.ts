import assert from "assert";
import fs from "fs";
import path from "path";
import { BitStream } from "../../shared/net/net.ts";
import {
    ZombieMissionMsg,
    ZombieMissionPhase,
} from "../../shared/net/zombieMissionMsg.ts";

const root = path.resolve(__dirname, "../..");
const iconRoot = path.join(root, "client/public/img/zombie-mission");
const expectedIcons = [
    "uranium.png",
    "plutonium.png",
    "tritium.png",
    "nuclear-console.png",
];

for (const file of expectedIcons) {
    const fullPath = path.join(iconRoot, file);
    assert.ok(fs.existsSync(fullPath), `${file} must be deployed with the client`);
    const png = fs.readFileSync(fullPath);
    assert.equal(
        png.subarray(0, 8).toString("hex"),
        "89504e470d0a1a0a",
        `${file} must be a valid PNG`,
    );
    assert.equal(png.readUInt32BE(16), 1254, `${file} width`);
    assert.equal(png.readUInt32BE(20), 1254, `${file} height`);
}

const gameSource = fs.readFileSync(path.join(root, "client/src/game.ts"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "client/index.html"), "utf8");
const gameCssSource = fs.readFileSync(path.join(root, "client/css/game.css"), "utf8");
const soundSource = fs.readFileSync(path.join(root, "client/src/soundDefs.ts"), "utf8");

const countdownBuffer = new ArrayBuffer(128);
const countdownWriter = new BitStream(countdownBuffer);
const countdownSent = new ZombieMissionMsg();
countdownSent.phase = ZombieMissionPhase.Countdown;
countdownSent.countdownMs = 45_000;
countdownSent.serialize(countdownWriter);
const countdownReceived = new ZombieMissionMsg();
countdownReceived.deserialize(new BitStream(countdownBuffer));
assert.equal(
    countdownReceived.countdownMs,
    45_000,
    "the wire format must preserve the full 45-second countdown in milliseconds",
);
for (const file of expectedIcons) {
    assert.ok(gameSource.includes(`/img/zombie-mission/${file}`));
}
assert.match(
    gameSource,
    /this\.map\.loadMap\([\s\S]*?if \(this\.map\.getMapDef\(\)\.gameMode\.zombieMode\) \{\s*this\.initializeZombieMissionIcons\(\);/,
    "mission icons must load only for zombie rooms",
);
const initSource = gameSource.slice(
    gameSource.indexOf("    init() {"),
    gameSource.indexOf("    free(keepWs = false)"),
);
assert.doesNotMatch(
    initSource,
    /initializeZombieMissionIcons\(\)/,
    "Game.init must not read map mode before MapMsg populates the map definition",
);
assert.match(
    gameSource,
    /zombieMissionDeviceSprite[\s\S]*zombieMissionElementSprites/,
    "the console and all three elements must render as sprites",
);
assert.doesNotMatch(
    `${gameSource}\n${indexSource}\n${gameCssSource}`,
    /zombie-nuke-flash/,
    "nuclear detonation must not flash the screen",
);
assert.doesNotMatch(
    gameSource,
    /移速\s*85%|移动速度降为\s*85%/,
    "mission HUD must describe carrying as weight instead of a speed percentage",
);
assert.match(gameSource, /负重：\$\{names\[msg\.carriedElement\]/);
assert.match(gameSource, /已拾取\$\{elementName\}，当前负重/);
assert.match(gameSource, /ZOMBIE_NUKE_SHAKE_CONTINUOUS_INTENSITY = 12/);
assert.match(gameSource, /ZOMBIE_NUKE_SHAKE_IMPACT_INTENSITY = 16/);
const evacuationSiren = path.join(
    root,
    "client/public/audio/sfx/zombie-nuke-evacuation-siren.mp3",
);
assert.ok(fs.existsSync(evacuationSiren), "evacuation siren must be deployed with the client");
assert.ok(fs.statSync(evacuationSiren).size > 100_000, "evacuation siren must not be empty");
assert.match(soundSource, /zombie_nuke_evacuation_siren/);
assert.match(gameSource, /playSound\(\s*"zombie_nuke_evacuation_siren"/);

const nuclearExplosion = path.join(
    root,
    "client/public/audio/sfx/nuclear_explosion.mp3",
);
assert.ok(fs.existsSync(nuclearExplosion), "nuclear explosion sound must be deployed");
assert.ok(fs.statSync(nuclearExplosion).size > 100_000, "nuclear explosion sound must not be empty");
assert.match(soundSource, /zombie_nuke_explosion:\s*\{[\s\S]*?nuclear_explosion\.mp3/);
assert.doesNotMatch(soundSource, /path:\s*"audio\/sfx\/zombie-nuke-explosion\.mp3"/);
assert.match(gameSource, /playSound\(\s*"zombie_nuke_explosion"/);

const geigerClick = path.join(
    root,
    "client/public/audio/sfx/zombie-geiger-click.wav",
);
assert.ok(fs.existsSync(geigerClick), "Geiger click must be deployed with the client");
const geigerWav = fs.readFileSync(geigerClick);
assert.equal(geigerWav.subarray(0, 4).toString("ascii"), "RIFF");
assert.equal(geigerWav.subarray(8, 12).toString("ascii"), "WAVE");
assert.match(soundSource, /zombie_geiger_click/);
assert.match(gameSource, /ZOMBIE_GEIGER_DETECTION_RANGE = 55/);
assert.match(gameSource, /cadenceRoll < 0\.45[\s\S]*55 \+ Math\.random\(\) \* 65/);
assert.match(gameSource, /cadenceRoll < 0\.9[\s\S]*250 \+ Math\.random\(\) \* 170/);
assert.match(gameSource, /cadenceRoll < 0\.25[\s\S]*cadenceRoll > 0\.88/);
assert.match(gameSource, /volumeScale: 0\.62 \+ Math\.random\(\) \* 0\.28/);
assert.match(gameSource, /detune: -140 \+ Math\.random\(\) \* 280/);
assert.match(gameSource, /closestDistance[\s\S]*distanceRatio[\s\S]*playSound\("zombie_geiger_click"/);
assert.match(
    gameSource,
    /msg\.inBunker \? "已进入地堡，保持隐蔽" : "进入地堡躲避"[\s\S]*remainingMs \/ 1000\)\.toFixed\(3\)/,
    "nuclear countdown must tell the player to shelter with millisecond precision",
);
assert.match(
    gameSource,
    /candidateDeadline = performance\.now\(\) \+ msg\.countdownMs[\s\S]*Math\.min\(this\.zombieMissionCountdownDeadline, candidateDeadline\)/,
    "the client must smoothly extrapolate authoritative snapshots without counting backwards",
);
assert.doesNotMatch(gameSource, /countdownTenths/);
assert.doesNotMatch(
    gameSource,
    /全部元素已就位，45秒后核爆，进入地堡避难/,
    "the old one-shot nuclear prompt must be removed",
);
assert.doesNotMatch(
    gameCssSource,
    /zombie-mission-pulse|#zombie-mission-hud\.danger[\s\S]{0,160}(?:scale\(|animation:|font-size:)/,
    "the nuclear shelter warning must not pulse or resize",
);

console.log("zombie mission icon smoke test passed");
