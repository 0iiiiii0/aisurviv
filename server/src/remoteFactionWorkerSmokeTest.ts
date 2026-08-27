import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    queryRemoteFactionJobs,
    REMOTE_FACTION_WORKER_PROTOCOL,
    remoteFactionGameAddress,
    startRemoteFactionJob,
    stopRemoteFactionJob,
} from "./bot/remoteFactionWorker.ts";
import { Config } from "./config.ts";
import { GameServer } from "./gameServer.ts";
import { TeamMode } from "../../shared/gameConfig.ts";

assert.equal(remoteFactionGameAddress("10.20.30.40", "127.0.0.1:3000", 9037), "10.20.30.40:9037");
assert.equal(remoteFactionGameAddress("[fd00::20]", "127.0.0.1:3000", 9037), "[fd00::20]:9037");
assert.throws(
    () => remoteFactionGameAddress("", "127.0.0.1:3000", 9037),
    /loopback/,
);

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "survev-remote-faction-worker-"));
const fakeSmartBot = path.join(temporaryRoot, "fake-smart-bot.mjs");
const workerConfig = path.join(temporaryRoot, "worker-config.json");
const fakeMapRuntime = path.join(temporaryRoot, "map-runtime");
const token = "remote-faction-worker-smoke-token-123456";
fs.mkdirSync(fakeMapRuntime, { recursive: true });
fs.writeFileSync(path.join(fakeMapRuntime, "manifest.json"), JSON.stringify({ formatVersion: 1 }));
fs.writeFileSync(
    fakeSmartBot,
    "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);\n",
);
fs.writeFileSync(workerConfig, JSON.stringify({
    listenHost: "127.0.0.1",
    controlPort: 0,
    token,
    maxWorkers: 2,
    runtimeRoot: temporaryRoot,
    smartBotPath: fakeSmartBot,
    logDirectory: path.join(temporaryRoot, "logs"),
    allowedGameHosts: ["10.20.30.40"],
}));

// The deployable compute package intentionally lives beside the main project,
// so copying the server root never ships the worker UI/runtime by accident.
const agentPath = path.resolve(import.meta.dirname, "../../../外接ai计算/worker-agent.mjs");
const agent = spawn(process.execPath, [agentPath, "--config", workerConfig], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
});

function waitForControlPort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error("remote worker did not start")), 5_000);
        let output = "";
        agent.stdout.on("data", (chunk: Buffer) => {
            output += chunk.toString();
            const match = /REMOTE_BOT_WORKER_LISTENING [^:]+:(\d+)/.exec(output);
            if (!match) return;
            clearTimeout(deadline);
            resolve(Number(match[1]));
        });
        agent.stderr.on("data", (chunk: Buffer) => {
            output += chunk.toString();
        });
        agent.once("exit", (code) => {
            clearTimeout(deadline);
            reject(new Error(`remote worker exited early (${code}): ${output}`));
        });
    });
}

try {
    const port = await waitForControlPort();
    const settings = {
        enabled: true,
        controlUrl: `http://127.0.0.1:${port}`,
        token,
        advertisedGameHost: "10.20.30.40",
        fallbackToLocal: true,
        requestTimeoutMs: 2_000,
    };
    await assert.rejects(
        queryRemoteFactionJobs(
            { ...settings, token: "wrong-remote-faction-token-123456" },
            ["authentication-probe"],
        ),
        /unauthorized/,
        "remote worker must reject a mismatched server/worker token",
    );
    const gameId = "0123456789abcdef0123456789abcdef01234567";
    const jobId = `${gameId}-smoke-job-12345678`;
    const matchData = {
        zone: "",
        gameId,
        data: "one-time-smoke-token",
        useHttps: false,
        hosts: ["10.20.30.40:9037"],
        addrs: ["10.20.30.40:9037"],
    };
    const started = await startRemoteFactionJob(settings, {
        protocolVersion: REMOTE_FACTION_WORKER_PROTOCOL,
        jobId,
        gameId,
        mapName: "faction",
        buildVersion: "smoke",
        environment: {
            BOT_DIRECT_MATCH_JSON: JSON.stringify(matchData),
            BOT_COUNT: "2",
            BOT_TEAM_SIZE: "4",
            BOT_FACTION_AI: "1",
            BOT_FACTION_FORCE: "1",
            BOT_EXPECTED_MAP_NAME: "faction",
            BOT_EXPECTED_MAP_SEED: String(0x1234abcd),
        },
    });
    assert.equal(started.jobId, jobId);
    assert.ok(started.pid);
    const running = await queryRemoteFactionJobs(settings, [jobId, "missing-smoke-job"]);
    assert.equal(running[0]?.state, "running");
    assert.equal(running[1]?.state, "missing");

    await stopRemoteFactionJob(settings, jobId);
    const deadline = Date.now() + 3_000;
    let state = "running";
    while (state === "running" && Date.now() < deadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, 40));
        state = (await queryRemoteFactionJobs(settings, [jobId]))[0]?.state ?? "missing";
    }
    assert.equal(state, "exited");

    const previousRemoteSettings = { ...Config.botAutoFill.remoteFactionWorker };
    try {
        Config.botAutoFill.remoteFactionWorker = {
            ...settings,
            advertisedGameHost: "10.20.30.40",
        };
        const gameServer = Object.create(GameServer.prototype) as GameServer;
        const messages: string[] = [];
        Object.assign(gameServer as unknown as Record<string, unknown>, {
            logger: {
                info: (message: string) => messages.push(message),
                warn: (message: string) => messages.push(message),
            },
            manager: {
                getProcessById: () => ({ port: 9037, gameData: { mapSeed: 0x1234abcd } }),
                getById: () => ({ stopped: false }),
            },
            region: { address: "127.0.0.1:3000", https: false },
            botProcesses: new Map(),
            remoteFactionBotJobs: new Map(),
            pendingBotCount: new Map(),
            duelBotClaims: new Set(),
            nextBotOrdinalByGame: new Map(),
            remoteFactionWorkerUnavailableUntil: 0,
        });
        const routed = (gameServer as unknown as {
            spawnGameBot(options: Record<string, unknown>): boolean;
        }).spawnGameBot({
            gameId,
            token: "one-time-routed-token",
            difficulty: "normal",
            mapName: "faction",
            teamMode: TeamMode.Squad,
            gameModeIdx: 0,
            adrenalineEnabled: true,
            botCount: 2,
            botTeamIds: [1, 2],
            joinDelayMs: 10,
        });
        assert.equal(routed, true);
        const routeDeadline = Date.now() + 3_000;
        let activeWorkers = 0;
        while (activeWorkers === 0 && Date.now() < routeDeadline) {
            await new Promise<void>((resolve) => setTimeout(resolve, 40));
            const health = await fetch(`${settings.controlUrl}/health`).then((response) => response.json()) as {
                activeWorkers: number;
            };
            activeWorkers = health.activeWorkers;
        }
        assert.equal(activeWorkers, 1, "GameServer must route faction workers to the remote node");
        assert.equal(
            (gameServer as unknown as { botProcesses: Map<string, unknown> }).botProcesses.size,
            0,
            "remote 50v50 routing must not spawn a local child process",
        );
        const acknowledgementDeadline = Date.now() + 2_000;
        while (
            !messages.some((message) => message.includes("remote-faction-worker"))
            && Date.now() < acknowledgementDeadline
        ) {
            await new Promise<void>((resolve) => setTimeout(resolve, 25));
        }
        (gameServer as unknown as {
            stopBotProcesses(gameId: string, reason: "room-stopped"): void;
        }).stopBotProcesses(gameId, "room-stopped");
        assert(messages.some((message) => message.includes("remote-faction-worker")));
    } finally {
        Config.botAutoFill.remoteFactionWorker = previousRemoteSettings;
    }
    console.log("Remote 50v50 worker smoke test passed: start/status/stop and address validation.");
} finally {
    if (agent.exitCode === null) {
        const exited = new Promise<void>((resolve) => agent.once("exit", () => resolve()));
        agent.kill("SIGTERM");
        await exited;
    }
    fs.rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 80 });
}
