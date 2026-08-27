import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AiMatchRecorder } from "./bot/aiMatchRecorder.ts";
import { isTerminalBotSocketClose } from "./bot/smartBotSupport.ts";
import { resolveInitialRosterDeficit } from "./botAutoFill.ts";
import { resolveBotWorkerMaxOldSpaceMb } from "./gameServer.ts";

// Deaths and disconnects do not reopen initial-roster slots. This is the main
// regression that previously launched replacement workers throughout a match.
assert.equal(resolveInitialRosterDeficit(80, 20, 20, 0, 0), 0);
assert.equal(resolveInitialRosterDeficit(80, 20, 7, 2, 8), 3);
assert.equal(resolveInitialRosterDeficit(12, 20, 6, 0, 0), 6);
// Parent pending and room token reservations describe the same bot seats. The
// larger source wins, preventing duplicate batches without double-counting.
assert.equal(resolveInitialRosterDeficit(80, 20, 7, 2, 0, 8), 3);
assert.equal(resolveInitialRosterDeficit(80, 20, 7, 2, 8, 8), 3);
assert.equal(resolveInitialRosterDeficit(80, 20, 7, 2, 3, 8), 3);

// A consumed/invalid token will never become valid by retrying it. Genuine
// host restarts and abnormal network closes remain reconnectable.
assert.equal(isTerminalBotSocketClose(3000, "invalid_token"), true);
assert.equal(isTerminalBotSocketClose(3000, "full"), true);
assert.equal(isTerminalBotSocketClose(3000, "server_restart"), false);
assert.equal(isTerminalBotSocketClose(1006, ""), false);
assert.equal(isTerminalBotSocketClose(1000, ""), true);

delete process.env.BOT_MATCH_RECORDING;
const recorder = new AiMatchRecorder({ rootDir: path.join(process.cwd(), ".unused-recorder") });
assert.equal(recorder.enabled, false, "ordinary AI recording must be opt-in");
assert.equal(fs.existsSync(recorder.sessionDir), false, "disabled recording creates no session directory");

assert.equal(resolveBotWorkerMaxOldSpaceMb(undefined), 512);
assert.equal(resolveBotWorkerMaxOldSpaceMb(64), 256);
assert.equal(resolveBotWorkerMaxOldSpaceMb(4096), 2048);

const serverSource = fs.readFileSync(path.join(import.meta.dirname, "gameServer.ts"), "utf8");
assert.match(serverSource, /BOT_CPU_LIMIT_ENABLED: process\.env\.BOT_CPU_LIMIT_ENABLED \?\? "1"/);
assert.match(serverSource, /child\.kill\("SIGKILL"\)/);
assert.match(
    serverSource,
    /resolveInitialRosterDeficit\([\s\S]*?game\.reservedBotCount/,
    "auto-fill must include authoritative unused bot-token reservations",
);
assert.match(
    serverSource,
    /child\.once\("exit", \(\) => \{[\s\S]*?releaseBotWorkerReservation/,
    "a dead coordinator must revoke its unfinished multi-use token immediately",
);

console.log(
    "Bot load protection passed: no post-death refill, permanent rejection cutoff, opt-in recording, CPU/heap limits and forced worker cleanup.",
);
