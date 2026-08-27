import assert from "node:assert/strict";
import { TeamMode } from "../../shared/gameConfig.ts";
import {
    getBotAutoFillPolicy,
    resolveBotAutoFillScheduleCount,
} from "./botAutoFill.ts";
import { Config } from "./config.ts";

const previousFactionLimit = Config.roomPlayerLimits.faction;
const previousFactionTarget = Config.botAutoFill.factionTargetPlayerCount;
try {
    Config.roomPlayerLimits.faction = 100;
    Config.botAutoFill.factionTargetPlayerCount = 40;
    const faction = getBotAutoFillPolicy("faction", TeamMode.Squad);
    assert.ok(faction);
    assert.equal(faction.processBatchSize, 40);
    assert.equal(
        resolveBotAutoFillScheduleCount(39, faction, 16),
        39,
        "one 50v50 scheduler pass must reserve the complete deficit",
    );
    assert.equal(
        Math.ceil(resolveBotAutoFillScheduleCount(39, faction, 16) / faction.processBatchSize!),
        1,
        "39 missing players must launch one shared-world coordinator",
    );
    assert.equal(
        resolveBotAutoFillScheduleCount(39, faction, 3),
        39,
        "one available worker is sufficient for the complete shared-world roster",
    );

    const ordinary = getBotAutoFillPolicy("main", TeamMode.Solo);
    assert.ok(ordinary);
    assert.equal(
        resolveBotAutoFillScheduleCount(19, ordinary, 16),
        19,
        "ordinary modes must put the room roster in one shared-world worker",
    );
    assert.equal(resolveBotAutoFillScheduleCount(19, ordinary, 0), 0);
} finally {
    Config.roomPlayerLimits.faction = previousFactionLimit;
    Config.botAutoFill.factionTargetPlayerCount = previousFactionTarget;
}

console.log("Shared-world auto-fill smoke test passed: each room deficit uses one coordinator worker.");
