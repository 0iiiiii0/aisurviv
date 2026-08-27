import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Source-level guarantees: a single bot's decision-loop exception must never
// kill the smart-bot worker process. A crashed worker drops every sibling bot
// in the batch at the same instant, which shows up in game logs as a mass AI
// quit in the middle of an ongoing match ("AI 大批量退出").
const smartBotSource = fs.readFileSync(path.join(import.meta.dirname, "smartBot.ts"), "utf8");

const tickStart = smartBotSource.indexOf("const runBotTick = (): void =>");
assert.ok(tickStart >= 0, "runBotTick scheduler must exist");
const tickEnd = smartBotSource.indexOf("runBotTick();", tickStart);
const schedulerSource = smartBotSource.slice(tickStart, tickEnd);

const tryIndex = schedulerSource.indexOf("try {");
const tickCallIndex = schedulerSource.indexOf("bot.tick(loadScale);");
assert.ok(tryIndex >= 0 && tickCallIndex > tryIndex, "bot.tick must run inside a try block");
assert.match(
    schedulerSource,
    /catch\s*\(error\)/,
    "bot.tick failures must be caught instead of crashing the worker",
);
assert.match(
    schedulerSource,
    /terminateForTickError/,
    "a repeatedly failing bot must be terminated individually",
);

assert.match(
    smartBotSource,
    /terminateForTickError\(detail: Record<string, unknown> = \{\}\): void \{[\s\S]*?this\.terminate\("tick_error"/,
    "the per-bot escape hatch must reuse the graceful termination path",
);

assert.match(
    smartBotSource,
    /process\.on\("uncaughtException"/,
    "worker must contain stray uncaught exceptions so remaining bots stay connected",
);
assert.match(
    smartBotSource,
    /process\.on\("unhandledRejection"/,
    "worker must contain unhandled promise rejections so remaining bots stay connected",
);
assert.doesNotMatch(
    smartBotSource.slice(smartBotSource.indexOf('process.on("uncaughtException"')),
    /process\.exit/,
    "the uncaughtException handler must not exit the process",
);

console.log(
    "Bot worker crash isolation smoke test passed: one failing bot can never take down its whole worker batch.",
);
