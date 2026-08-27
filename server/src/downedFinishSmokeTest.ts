import assert from "assert/strict";
import fs from "fs";
import path from "path";
import { ModeStrategy } from "./bot/modeStrategy.ts";
import { TeamMode } from "../../shared/gameConfig.ts";

// 1) Mode strategy: a downed enemy is a priority finish when the bot is safe,
// and is still deprioritized while a direct threat exists.
{
    const solo = new ModeStrategy();
    solo.load("main", TeamMode.Solo);
    const faction = new ModeStrategy();
    faction.load("faction", TeamMode.Squad);

    const base = {
        distance: 12,
        downed: true,
        enemyRole: "",
        phase: "mid" as const,
        currentTarget: false,
    };
    const soloFinish = solo.targetScoreModifier({ ...base, finishDowned: true });
    const soloThreat = solo.targetScoreModifier({ ...base, finishDowned: false });
    assert.ok(soloFinish > soloThreat, "finishing a downed enemy must outrank ignoring it");
    assert.ok(soloFinish > 0, "a safe finish should be a positive score contribution");

    const factionFinish = faction.targetScoreModifier({ ...base, finishDowned: true });
    const factionThreat = faction.targetScoreModifier({ ...base, finishDowned: false });
    assert.ok(factionFinish > factionThreat, "faction finish must outrank the threat penalty");
}

// 2) Source guarantees for the bot wiring.
const smartBotSource = fs.readFileSync(path.join(__dirname, "smartBot.ts"), "utf8") + "\n" + fs.readFileSync(path.join(__dirname, "bot", "smartBotSupport.ts"), "utf8");
assert.ok(smartBotSource.includes("directThreatActive"), "the bot must detect a direct threat before scoring targets");
assert.ok(
    smartBotSource.includes("downedPenalty = data.downed ? (directThreatActive ? 45 : -20) : 0;"),
    "downed enemies are finished (bonus) when safe, ignored (penalty) under threat",
);
assert.ok(
    smartBotSource.includes("finishDowned: Boolean(data.downed) && !directThreatActive,"),
    "the mode strategy must receive the safe-finish flag",
);
const modeSource = fs.readFileSync(path.join(__dirname, "bot", "modeStrategy.ts"), "utf8");
assert.ok(modeSource.includes("finishDowned"), "the mode strategy must understand the safe-finish flag");
assert.ok(modeSource.includes("? 22"), "a safe finish must add a positive score bonus");

console.log("Downed-enemy finish smoke test passed: bots finish downed enemies in view when no direct threat exists.");