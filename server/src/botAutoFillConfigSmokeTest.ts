import assert from "assert";
import { TeamMode } from "../../shared/gameConfig.ts";
import {
    accelerateEarlyFillIntervalMs,
    getBotAutoFillModeKey,
    getBotAutoFillPolicy,
} from "./botAutoFill.ts";
import { Config } from "./config.ts";
import { getEffectiveRoomPlayerLimit } from "./game/gameManager.ts";

const previousBotAutoFill = JSON.parse(JSON.stringify(Config.botAutoFill)) as typeof Config.botAutoFill;
const previousRoomLimits = { ...Config.roomPlayerLimits };
try {
    Config.roomPlayerLimits = { solo: 60, duo: 60, squad: 60, faction: 100 };
    Config.botAutoFill.defaultJoinIntervalMs = 3500;
    Config.botAutoFill.soloTargetPlayerCount = 80;
    Config.botAutoFill.duoTargetPlayerCount = 80;
    Config.botAutoFill.squadTargetPlayerCount = 80;
    Config.botAutoFill.factionTargetPlayerCount = 60;
    Config.botAutoFill.extractionSecretSoloTargetPlayerCount = 0;
    Config.botAutoFill.extractionSecretDuoTargetPlayerCount = 0;
    Config.botAutoFill.extractionSecretSquadTargetPlayerCount = 0;
    Config.botAutoFill.difficultyRatios = { normal: 40, hard: 30, pro: 20, legit: 10 };
    Config.botAutoFill.highBudgetIntervalMs = 3;
    // Legacy per-mode overrides must be ignored: every AI shares the unified
    // backend-wide interval.
    Config.botAutoFill.modeOverrides = {
        [getBotAutoFillModeKey("main", TeamMode.Solo)]: { joinIntervalMs: 1250 },
        [getBotAutoFillModeKey("faction", TeamMode.Squad)]: { joinIntervalMs: 5000 },
    };

    const solo = getBotAutoFillPolicy("main", TeamMode.Solo);
    assert.ok(solo);
    assert.equal(solo.joinIntervalMs, 3500, "all AI must share the unified join interval");
    assert.equal(solo.maxPlayers, 60);
    assert.equal(solo.targetPlayerCount, 60, "solo target must clamp only to the room maximum");
    assert.ok(
        Number.isInteger(Config.botAutoFill.maxBotWorkers) &&
            Config.botAutoFill.maxBotWorkers >= 1 &&
            Config.botAutoFill.maxBotWorkers <= 64,
        "global bot-worker cap must be a positive bounded value",
    );

    const duo = getBotAutoFillPolicy("main", TeamMode.Duo);
    assert.ok(duo);
    assert.equal(duo.joinIntervalMs, 3500);
    assert.equal(duo.targetPlayerCount, 60);
    assert.equal(Config.botAutoFill.difficultyRatios.legit, 10);
    assert.equal(Config.botAutoFill.highBudgetIntervalMs, 3);

    const faction = getBotAutoFillPolicy("faction", TeamMode.Squad);
    assert.ok(faction);
    assert.equal(faction.joinIntervalMs, 3500, "50v50 AI must also use the unified interval");
    assert.equal(faction.maxPlayers, 100);
    assert.equal(faction.targetPlayerCount, 60, "50v50 uses its own fill cap (factionTargetPlayerCount)");

    // 绝密搜打撤独立补齐目标（按队形分别配置）：0 = 跟随普通模式同队形目标。
    const secretDefault = getBotAutoFillPolicy("extraction_secret", TeamMode.Solo);
    assert.ok(secretDefault);
    assert.equal(
        secretDefault.targetPlayerCount,
        60,
        "secret extraction falls back to the ordinary solo target when unset",
    );
    Config.botAutoFill.extractionSecretSoloTargetPlayerCount = 24;
    const secretSolo = getBotAutoFillPolicy("extraction_secret", TeamMode.Solo);
    assert.ok(secretSolo);
    assert.equal(
        secretSolo.targetPlayerCount,
        24,
        "secret extraction uses its own independent fill target",
    );
    // 双人未被设置时跟随普通双人目标。
    const secretDuo = getBotAutoFillPolicy("extraction_secret", TeamMode.Duo);
    assert.ok(secretDuo);
    assert.equal(
        secretDuo.targetPlayerCount,
        60,
        "secret duo falls back to the ordinary duo target when unset",
    );
    Config.botAutoFill.extractionSecretDuoTargetPlayerCount = 32;
    assert.equal(
        getBotAutoFillPolicy("extraction_secret", TeamMode.Duo)?.targetPlayerCount,
        32,
        "secret duo uses its own independent fill target",
    );
    Config.botAutoFill.extractionSecretSquadTargetPlayerCount = 40;
    assert.equal(
        getBotAutoFillPolicy("extraction_secret", TeamMode.Squad)
            ?.targetPlayerCount,
        40,
        "secret squad uses its own independent fill target",
    );
    // 四人绝密：绝密目标可以大于普通小队房间上限，房间容量应抬升到绝密目标，
    // 否则开局 AI 永远补不满（"四人绝密开局卡住 / AI 永远补不满"）。
    Config.roomPlayerLimits.squad = 20;
    Config.botAutoFill.extractionSecretSquadTargetPlayerCount = 30;
    const secretSquadBig = getBotAutoFillPolicy(
        "extraction_secret",
        TeamMode.Squad,
    );
    assert.ok(secretSquadBig);
    assert.equal(
        secretSquadBig.maxPlayers,
        30,
        "secret squad room must grow to its own target (30) instead of the shared squad cap (20)",
    );
    assert.equal(
        secretSquadBig.targetPlayerCount,
        30,
        "secret squad fill target must not be truncated by the shared squad cap",
    );
    assert.equal(
        getEffectiveRoomPlayerLimit("extraction_secret", TeamMode.Squad),
        30,
        "getEffectiveRoomPlayerLimit must raise extraction_secret squad to its target",
    );
    // 其他模式仍保持共享的小队上限。
    Config.botAutoFill.extractionSecretSquadTargetPlayerCount = 0;
    assert.equal(getEffectiveRoomPlayerLimit("extraction", TeamMode.Squad), 20);
    assert.equal(getEffectiveRoomPlayerLimit("main", TeamMode.Squad), 20);
    Config.botAutoFill.extractionSecretSquadTargetPlayerCount = 30;
    Config.botAutoFill.extractionSecretSoloTargetPlayerCount = 0;
    Config.botAutoFill.extractionSecretDuoTargetPlayerCount = 0;
    Config.botAutoFill.extractionSecretSquadTargetPlayerCount = 0;

    Config.botAutoFill.factionTargetPlayerCount = 0;
    assert.equal(
        getBotAutoFillPolicy("faction", TeamMode.Squad)?.targetPlayerCount,
        80,
        "faction cap falls back to the ordinary target when unset",
    );
    Config.botAutoFill.factionTargetPlayerCount = 60;

    assert.equal(getBotAutoFillPolicy("duel", TeamMode.Solo), undefined);
    assert.equal(
        getBotAutoFillPolicy("zombie", TeamMode.Solo),
        undefined,
        "zombie mode must use only ZombieModeSystem bots, never generic smart-bot auto-fill",
    );

    // Early-fill acceleration: a waiting first human sees ~800ms joins inside
    // the window, then the configured cadence resumes.
    assert.equal(accelerateEarlyFillIntervalMs(2000, 0), 800);
    assert.equal(accelerateEarlyFillIntervalMs(2000, 500), 800);
    assert.equal(accelerateEarlyFillIntervalMs(2000, 14_999), 800);
    assert.equal(accelerateEarlyFillIntervalMs(2000, 15_000), 2000);
    assert.equal(accelerateEarlyFillIntervalMs(2000, 60_000), 2000);
    assert.equal(accelerateEarlyFillIntervalMs(5000, 1000), 800);
    assert.equal(accelerateEarlyFillIntervalMs(700, 1000), 700, "acceleration never goes below the 500ms floor nor above the configured cadence");
    assert.equal(accelerateEarlyFillIntervalMs(2000, Number.POSITIVE_INFINITY), 2000);
    console.log("Bot auto-fill config smoke test passed: one unified AI join interval for every mode, independent per-mode humans+AI targets clamped per room maximum, separate secret-extraction target.");
} finally {
    Config.botAutoFill = previousBotAutoFill;
    Config.roomPlayerLimits = previousRoomLimits;
}
