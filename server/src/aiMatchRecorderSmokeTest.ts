import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import { AiMatchRecorder, DEFAULT_RECORDING_STORAGE_LIMIT } from "./bot/aiMatchRecorder.ts";

process.env.BOT_MATCH_RECORDING = "0";

const dirSize = (target: string): number => {
    const stat = fs.statSync(target);
    if (stat.isFile()) return stat.size;
    return fs.readdirSync(target).reduce((sum, name) => sum + dirSize(path.join(target, name)), 0);
};

void (async () => {
    assert.equal(DEFAULT_RECORDING_STORAGE_LIMIT, 1_073_741_824);
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "surviv-recorder-"));
    const oldSession = path.join(rootDir, "2000-01-01-old-session");
    fs.mkdirSync(oldSession, { recursive: true });
    fs.writeFileSync(path.join(oldSession, "old.bin"), Buffer.alloc(18_000));
    fs.utimesSync(oldSession, new Date(1), new Date(1));

    const limit = 28_000;
    const recorder = new AiMatchRecorder({
        enabled: true,
        rootDir,
        sampleMs: 100,
        maxPartBytes: 4096,
        maxStorageBytes: limit,
    });
    recorder.registerBot("match:test", {
        botId: 1,
        difficulty: "pro",
        squadId: 1,
        squadSlot: 0,
        role: "assault",
    });
    recorder.recordMap("match:test", {
        mapName: "main",
        seed: 42,
        width: 1024,
        height: 1024,
        objects: [{ type: "container_01", pos: { x: 100, y: 100 } }],
    });
    recorder.recordEvent("match:test", {
        type: "concealment_fire_burst",
        at: 1000,
        botId: 1,
        zoneKey: "roof:7",
    });
    recorder.recordFrame("match:test", 1, 1000, {
        state: "flush",
        self: { pos: { x: 60.123456, y: 100 } },
        hiddenContact: { enemyId: 9, zoneKey: "roof:7" },
    });
    for (let i = 0; i < 80; i++) {
        recorder.recordFrame("match:test", 1, 1200 + i * 100, {
            payload: "x".repeat(700),
            index: i,
        }, true);
    }
    recorder.close();

    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(fs.existsSync(oldSession), false, "oldest inactive session must be rotated first");
    assert(dirSize(rootDir) <= limit + 256, "recording root must stay at the configured total cap");

    const sessionEntries = fs.readdirSync(rootDir);
    assert.equal(sessionEntries.length, 1, "only the active recorder session should remain");
    const sessionDir = path.join(rootDir, sessionEntries[0]);
    const matchDir = path.join(sessionDir, "match-match_test");
    assert.ok(fs.existsSync(path.join(sessionDir, "manifest.json")));
    assert.ok(fs.existsSync(path.join(matchDir, "map.json")));
    assert.ok(fs.existsSync(path.join(matchDir, "events-001.jsonl")));
    assert.ok(fs.existsSync(path.join(matchDir, "frames-001.jsonl")));
    assert.ok(fs.existsSync(path.join(matchDir, "recording.truncated")));
    assert.equal(
        fs.readdirSync(matchDir).some((name) => name.endsWith(".part")),
        false,
        "normal close must finalize all temporary parts",
    );

    const manifest = JSON.parse(fs.readFileSync(path.join(sessionDir, "manifest.json"), "utf8"));
    assert.equal(manifest.version, 13);
    assert.equal(manifest.maxStorageBytes, limit);
    const mapText = fs.readFileSync(path.join(matchDir, "map.json"), "utf8");
    const map = JSON.parse(mapText);
    assert.equal(map.map.mapName, "main");
    assert.equal(mapText.includes("\n"), false);
    const events = fs.readFileSync(path.join(matchDir, "events-001.jsonl"), "utf8");
    const frames = fs.readFileSync(path.join(matchDir, "frames-001.jsonl"), "utf8");
    assert.match(events, /concealment_fire_burst/);
    assert.match(frames, /hiddenContact/);
    assert.match(frames, /60\.123/);

    fs.rmSync(rootDir, { recursive: true, force: true });
    await testMatchEndedEvent();
    console.log("AI match recorder quota/rotation smoke test passed");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

async function testMatchEndedEvent(): Promise<void> {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "surviv-recorder-ended-"));
    const recorder = new AiMatchRecorder({
        enabled: true,
        rootDir,
        sampleMs: 100,
        maxPartBytes: 4096,
        maxStorageBytes: 1024 * 1024,
    });
    recorder.registerBot("match:ended", {
        botId: 1, difficulty: "normal", squadId: 1, squadSlot: 0, role: "assault",
    });
    recorder.registerBot("match:ended", {
        botId: 2, difficulty: "normal", squadId: 1, squadSlot: 1, role: "support",
    });
    recorder.recordFrame("match:ended", 1, 1000, { state: "explore" }, true);
    recorder.finishBot("match:ended", 1, "died", { kills: 0 });
    recorder.finishBot("match:ended", 2, "won", { kills: 3 });
    recorder.close();
    await new Promise((resolve) => setTimeout(resolve, 150));

    const sessionDir = path.join(rootDir, fs.readdirSync(rootDir)[0]);
    const matchDir = path.join(sessionDir, "match-match_ended");
    const events = fs.readFileSync(path.join(matchDir, "events-001.jsonl"), "utf8");
    assert.match(events, /"type":"bot_finished"/);
    assert.match(events, /"type":"match_ended"/, "match_ended must be written once all registered bots finish");
    const endedLine = events.split("\n").find((line) => line.includes('"type":"match_ended"'));
    assert.ok(endedLine, "match_ended line must exist");
    const ended = JSON.parse(endedLine!);
    assert.equal(ended.botCount, 2);
    assert.equal(ended.framesWritten, 1);
    assert.deepEqual(ended.results, [
        { botId: 1, reason: "died" },
        { botId: 2, reason: "won" },
    ]);

    // A second finish for the same bot must not duplicate match_ended.
    const before = events.match(/"type":"match_ended"/g)?.length ?? 0;
    assert.equal(before, 1);

    fs.rmSync(rootDir, { recursive: true, force: true });
}
