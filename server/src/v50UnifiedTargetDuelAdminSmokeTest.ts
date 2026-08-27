import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TeamMode } from "../../shared/gameConfig.ts";
import { getBotAutoFillPolicy, planFactionBotTeamIds } from "./botAutoFill.ts";
import { Config, migrateLegacyBotAutoFillConfig } from "./config.ts";
import { createServerGameConfig } from "./game/gameManager.ts";

const projectRoot = path.join(import.meta.dirname, "../..");
const adminHtml = fs.readFileSync(path.join(projectRoot, "client/public/admin/index.html"), "utf8");
const adminJs = fs.readFileSync(path.join(projectRoot, "client/public/admin/admin.js"), "utf8");
const siteInfo = fs.readFileSync(path.join(projectRoot, "client/src/siteInfo.ts"), "utf8");
const legacyRouter = fs.readFileSync(
    path.join(projectRoot, "server/src/api/routes/legacy/LegacyRouter.ts"),
    "utf8",
);
const gameServer = fs.readFileSync(path.join(projectRoot, "server/src/gameServer.ts"), "utf8");

assert.doesNotMatch(adminHtml, /单\/双\/四排统一AI上限|bot-ordinary-limit/);
assert.match(adminHtml, /id="bot-solo-target-player-count"/);
assert.match(adminHtml, /id="bot-duo-target-player-count"/);
assert.match(adminHtml, /id="bot-squad-target-player-count"/);
assert.match(adminHtml, /id="bot-faction-target-player-count"/);
assert.doesNotMatch(adminHtml, /id="bot-target-player-count"/);
assert.doesNotMatch(adminHtml, /bot-autofill-grid/);
assert.doesNotMatch(adminHtml, /id="duel-random-mode-enabled"|id="duel-room-mode-enabled"/);

assert.doesNotMatch(adminJs, /botOrdinaryLimit|ordinaryBotLimit|\bNumber\(roomLimit/);
assert.match(adminJs, /roomPlayerLimitsDraft/);
assert.match(adminJs, /if \(!limits \|\| state\.roomPlayerLimitsDraft\) return/);
assert.match(adminJs, /parseDraftNumber\(roomLimitSolo\.value, 1, 100, 1\)/);
assert.match(adminJs, /空白输入不会自动补0/);
assert.match(adminJs, /const target = parseDraftNumber\(input\.value, min, max, 1\)/);
assert.match(adminJs, /wireBotTargetInput\(botSoloTargetPlayerCount, "soloTargetPlayerCount"\)/);
assert.match(adminJs, /wireBotTargetInput\(botDuoTargetPlayerCount, "duoTargetPlayerCount"\)/);
assert.match(adminJs, /wireBotTargetInput\(botSquadTargetPlayerCount, "squadTargetPlayerCount"\)/);
assert.match(adminJs, /wireBotTargetInput\(botFactionTargetPlayerCount, "factionTargetPlayerCount"\)/);
assert.match(adminJs, /if \(target === null\) return/);
assert.doesNotMatch(adminJs, /botAutoFillGrid|forceGrid/);
assert.doesNotMatch(adminJs, /botTargetPlayerCount/);
assert.doesNotMatch(adminJs, /duelRandomModeEnabled\.addEventListener|duelRoomModeEnabled\.addEventListener/);
assert.match(siteInfo, /style\.mapName === "duel"[\s\S]*?"随机1v1"/);
assert.match(siteInfo, /duelRoomEnabled !== false/);
assert.match(legacyRouter, /if \(!Config\.duel\.roomModeEnabled\)/);
assert.match(gameServer, /if \(!Config\.duel\.roomModeEnabled\)/);

const legacy = {
    ordinaryBotLimit: 20,
    modeOverrides: {
        "main:1": { targetPlayerCount: 32 },
        "faction:4": { botLimit: 80 },
    },
} as Record<string, unknown>;
migrateLegacyBotAutoFillConfig(legacy);
assert.equal(legacy.soloTargetPlayerCount, 80, "migration must preserve the largest old fill target");
assert.equal(legacy.duoTargetPlayerCount, 80);
assert.equal(legacy.squadTargetPlayerCount, 80);
assert.equal(legacy.factionTargetPlayerCount, 80);
assert.equal("targetPlayerCount" in legacy, false, "the legacy shared field must be consumed");
const shared = { targetPlayerCount: 55, ordinaryBotLimit: 99 } as Record<string, unknown>;
migrateLegacyBotAutoFillConfig(shared);
assert.equal(shared.soloTargetPlayerCount, 55, "a V80 shared target must seed all four targets");
assert.equal(shared.duoTargetPlayerCount, 55);
assert.equal(shared.squadTargetPlayerCount, 55);
assert.equal(shared.factionTargetPlayerCount, 55);
const split = {
    soloTargetPlayerCount: 10,
    duoTargetPlayerCount: 20,
    squadTargetPlayerCount: 30,
    factionTargetPlayerCount: 40,
    targetPlayerCount: 99,
} as Record<string, unknown>;
migrateLegacyBotAutoFillConfig(split);
assert.equal(split.soloTargetPlayerCount, 10, "split targets must stay untouched");
assert.equal(split.factionTargetPlayerCount, 40);
assert.equal("targetPlayerCount" in split, false, "stale shared field must be removed from split configs");

const previousSoloTarget = Config.botAutoFill.soloTargetPlayerCount;
const previousDuoTarget = Config.botAutoFill.duoTargetPlayerCount;
const previousSquadTarget = Config.botAutoFill.squadTargetPlayerCount;
const previousFactionTarget = Config.botAutoFill.factionTargetPlayerCount;
const previousLimits = { ...Config.roomPlayerLimits };
try {
    Config.botAutoFill.soloTargetPlayerCount = 80;
    Config.botAutoFill.duoTargetPlayerCount = 80;
    Config.botAutoFill.squadTargetPlayerCount = 80;
    Config.botAutoFill.factionTargetPlayerCount = 80;
    Config.roomPlayerLimits = { solo: 64, duo: 64, squad: 64, faction: 100 };
    assert.equal(getBotAutoFillPolicy("main", TeamMode.Solo)?.targetPlayerCount, 64, "solo clamps to the 64-player room maximum");
    assert.equal(getBotAutoFillPolicy("main", TeamMode.Duo)?.targetPlayerCount, 64);
    assert.equal(getBotAutoFillPolicy("main", TeamMode.Squad)?.targetPlayerCount, 64);
    assert.equal(getBotAutoFillPolicy("faction", TeamMode.Squad)?.targetPlayerCount, 80, "50v50 keeps its own 100-player target");
    Config.botAutoFill.factionTargetPlayerCount = 60;
    assert.equal(getBotAutoFillPolicy("faction", TeamMode.Squad)?.targetPlayerCount, 60, "50v50 uses its independent fill cap");
    assert.equal(
        createServerGameConfig({ mapName: "faction", teamMode: TeamMode.Squad }).maxPlayersOverride,
        undefined,
        "50v50 room process capacity must remain the map-native 100 rather than the ordinary squad limit",
    );
    assert.deepEqual(
        planFactionBotTeamIds({
            connectedBotTeamCounts: [20, 20],
            pendingBotTeamCounts: [0, 0],
            connectedPlayerCount: 40,
            reservedHumanCount: 0,
            maxPlayers: 100,
            targetPlayerCount: 80,
            spawnPerSecond: 8,
        }),
        [1, 2, 1, 2, 1, 2, 1, 2],
        "50v50 must continue filling after 40 total contestants",
    );
} finally {
    Config.botAutoFill.soloTargetPlayerCount = previousSoloTarget;
    Config.botAutoFill.duoTargetPlayerCount = previousDuoTarget;
    Config.botAutoFill.squadTargetPlayerCount = previousSquadTarget;
    Config.botAutoFill.factionTargetPlayerCount = previousFactionTarget;
    Config.roomPlayerLimits = previousLimits;
}

console.log("V50 unified target/duel/admin smoke test passed: no old AI cap, four independent humans+AI targets (solo/duo/squad/50v50), independent duel switches, legacy migration, and blank numeric drafts without auto-zero.");
