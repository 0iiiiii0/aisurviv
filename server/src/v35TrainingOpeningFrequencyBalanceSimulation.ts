import assert from "assert";
import { DEFAULT_AI_THINK_INTERVALS, normalizeAiThinkIntervals } from "./botDifficulty.ts";
import { DIFFICULTY_PROFILES } from "./bot/difficultyProfiles.ts";
import { evaluateDualSwitch } from "./bot/dualSwitch.ts";
import { openingWeaponSearchProfile } from "./bot/openingWeaponSearch.ts";
import { visibleTriggerDeadlineMs } from "./bot/engagementRecovery.ts";

const intervals = normalizeAiThinkIntervals({
    normal: 150,
    hard: 72,
    pro: 30,
    legit: 6,
    forbidden: 3,
});
assert.deepEqual(intervals, {
    normal: 150,
    hard: 72,
    pro: 30,
    legit: 6,
    forbidden: 3,
});
assert.deepEqual(normalizeAiThinkIntervals({ normal: 999, legit: 0 }), {
    normal: 250,
    hard: DEFAULT_AI_THINK_INTERVALS.hard,
    pro: DEFAULT_AI_THINK_INTERVALS.pro,
    legit: 1,
    forbidden: DEFAULT_AI_THINK_INTERVALS.forbidden,
});

const opening = openingWeaponSearchProfile(true, 2_000, false);
const postOpening = openingWeaponSearchProfile(true, 28_000, false);
assert.equal(opening.opening, true);
assert(opening.gunRange > postOpening.gunRange);
assert(opening.gunUrgency > postOpening.gunUrgency);
assert(opening.lootLockMs > postOpening.lootLockMs);
assert(opening.crateRangeMultiplier > postOpening.crateRangeMultiplier);

const sniperToShotgun = evaluateDualSwitch({
    difficulty: "legit",
    currentType: "mosin",
    otherType: "m870",
    currentCooldown: 1.75,
    otherCooldown: 0,
    otherAmmo: 5,
    otherInRange: true,
    currentFireMode: "single",
    otherFireMode: "single",
    currentFireDelay: 1.75,
    otherFireDelay: 0.9,
    currentMaxClip: 5,
    currentBulletCount: 1,
    otherBulletCount: 9,
    currentRange: 86,
    otherRange: 27,
    targetDistance: 18,
    switchDelay: 0.9,
    shotConfirmed: true,
});
const shotgunToSniper = evaluateDualSwitch({
    difficulty: "legit",
    currentType: "m870",
    otherType: "mosin",
    currentCooldown: 0.9,
    otherCooldown: 0,
    otherAmmo: 5,
    otherInRange: true,
    currentFireMode: "single",
    otherFireMode: "single",
    currentFireDelay: 0.9,
    otherFireDelay: 1.75,
    currentMaxClip: 5,
    currentBulletCount: 9,
    otherBulletCount: 1,
    currentRange: 27,
    otherRange: 86,
    targetDistance: 18,
    switchDelay: 1,
    shotConfirmed: true,
});
assert.equal(sniperToShotgun.useful, true);
assert.equal(shotgunToSniper.useful, true);

const difficultySummary = Object.fromEntries(
    Object.entries(DIFFICULTY_PROFILES).map(([name, profile]) => [name, {
        decisionsPerSecond: Number((1000 / profile.thinkIntervalMs).toFixed(1)),
        reactionMs: profile.reactionMs,
        forcedTriggerDeadlineMs: visibleTriggerDeadlineMs(
            name as keyof typeof DIFFICULTY_PROFILES,
            profile.reactionMs,
        ),
        aimJitterRad: profile.aimJitterRad,
        shootConfidence: profile.shootConfidence,
        targetMemoryMs: profile.targetMemoryMs,
    }]),
);
assert.deepEqual(
    DIFFICULTY_PROFILES.normal,
    {
        thinkIntervalMs: 100,
        reactionMs: 120,
        aimJitterRad: 0.036,
        leadFactor: 0.94,
        targetMemoryMs: 1500,
        combatScanRange: 88,
        shootConfidence: 0.92,
        strafePeriodMs: 760,
        retreatHealth: 32,
        healEnemyRange: 36,
    },
    "the default Normal AI must not fall below surviv.io-main combat capability",
);
assert(DIFFICULTY_PROFILES.normal.reactionMs > DIFFICULTY_PROFILES.hard.reactionMs);
assert(DIFFICULTY_PROFILES.normal.aimJitterRad > DIFFICULTY_PROFILES.hard.aimJitterRad);
assert(DIFFICULTY_PROFILES.legit.thinkIntervalMs < DIFFICULTY_PROFILES.pro.thinkIntervalMs);
assert.equal(DIFFICULTY_PROFILES.legit.aimJitterRad, 0);
assert.equal(DIFFICULTY_PROFILES.legit.shootConfidence, 1);

const output = {
    aimTraining: {
        lockPlayersUntilFull: false,
        startCondition: "first human contestant",
        roleBasedSpawnOrder: true,
        persistentWithOneHuman: true,
    },
    independentThinkIntervalsMs: intervals,
    openingWeaponSearch: {
        opening,
        postOpening,
        rangeIncreasePercent: Number(((opening.gunRange / postOpening.gunRange - 1) * 100).toFixed(1)),
    },
    sniperShotgunQuickSwitch: {
        sniperToShotgun,
        shotgunToSniper,
        requiresConfirmedShotBeforeEachSwitch: true,
    },
    difficultySummary,
};
console.log(JSON.stringify(output, null, 2));
